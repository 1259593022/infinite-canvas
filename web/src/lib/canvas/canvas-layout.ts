import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

import { nodeBounds } from "./canvas-node-geometry";

/**
 * 一键整理：顺着连线把节点从左到右排成列。
 *
 * 这个画布的典型用法是 参考图 → 配置 → 生图 → 结果，是一条有向链路，
 * 所以按连线分层比网格铺开更有意义——整理完一眼能看出哪张图是怎么来的。
 *
 * 分组当作一个整体单元参与排布：组内相对位置和外框都不变，只是整体挪位置。
 */

/** 列间距。留得比行距宽，让「一列 = 一个阶段」的层次感明显。 */
const COLUMN_GAP = 96;
const ROW_GAP = 48;
/** 孤立节点在下方铺网格时每行放几个 */
const ORPHAN_COLUMNS = 6;
/** 分层区和孤立区之间的留白 */
const SECTION_GAP = 120;

/** 一个布局单元：单个节点，或一个分组连同它的全部成员。 */
type Unit = {
    id: string;
    /** 该单元包含的全部节点 id，分组单元包含分组自己和所有成员 */
    memberIds: string[];
    x: number;
    y: number;
    width: number;
    height: number;
};

export function tidyNodes(nodes: CanvasNodeData[], connections: CanvasConnection[], selectedIds: Set<string>): CanvasNodeData[] | null {
    const scopeIds = resolveScope(nodes, selectedIds);
    if (scopeIds.size < 2) return null;

    const units = buildUnits(nodes, scopeIds);
    if (units.length < 2) return null;

    const unitOfNode = new Map<string, string>();
    for (const unit of units) {
        for (const id of unit.memberIds) unitOfNode.set(id, unit.id);
    }

    const { columns, orphans } = layerUnits(units, connections, unitOfNode);
    const placed = placeUnits(columns, orphans);

    // 锚定到整理前的包围盒左上角。只整理选区时尤其重要——
    // 框选一小簇来整理，结果整簇跳到画布另一头，这功能就等于不能用。
    const before = boundsOfUnits(units);
    const after = boundsOfUnits(placed);
    const anchorX = before.left - after.left;
    const anchorY = before.top - after.top;

    // 单元位移量按节点摊开：分组成员和分组外框位移相同，所以外框不用重算
    const deltas = new Map<string, { dx: number; dy: number }>();
    const byId = new Map(units.map((unit) => [unit.id, unit]));
    for (const unit of placed) {
        const original = byId.get(unit.id);
        if (!original) continue;
        const dx = unit.x + anchorX - original.x;
        const dy = unit.y + anchorY - original.y;
        if (dx === 0 && dy === 0) continue;
        for (const id of unit.memberIds) deltas.set(id, { dx, dy });
    }
    if (!deltas.size) return null;

    return nodes.map((node) => {
        const delta = deltas.get(node.id);
        if (!delta) return node;
        return { ...node, position: { x: node.position.x + delta.dx, y: node.position.y + delta.dy } };
    });
}

/** 选中超过一个就只整理选中的（含选中分组的成员），否则整理全部。 */
function resolveScope(nodes: CanvasNodeData[], selectedIds: Set<string>): Set<string> {
    if (selectedIds.size < 2) return new Set(nodes.map((node) => node.id));

    const scope = new Set(selectedIds);
    // 选中了分组就把成员一并纳入，否则分组框会和成员分家
    const selectedGroups = new Set(nodes.filter((node) => selectedIds.has(node.id) && node.type === CanvasNodeType.Group).map((node) => node.id));
    for (const node of nodes) {
        const groupId = node.metadata?.groupId;
        if (groupId && selectedGroups.has(groupId)) scope.add(node.id);
        // 反过来：选中了成员，也要把它所属的分组框带上
        if (groupId && selectedIds.has(node.id)) scope.add(groupId);
    }
    return scope;
}

function buildUnits(nodes: CanvasNodeData[], scopeIds: Set<string>): Unit[] {
    const inScope = nodes.filter((node) => scopeIds.has(node.id));
    const members = new Map<string, CanvasNodeData[]>();
    for (const node of inScope) {
        const groupId = node.metadata?.groupId;
        if (node.type !== CanvasNodeType.Group && groupId) members.set(groupId, [...(members.get(groupId) || []), node]);
    }

    const units: Unit[] = [];
    for (const node of inScope) {
        if (node.type === CanvasNodeType.Group) {
            const children = members.get(node.id) || [];
            const box = nodeBounds([node, ...children]);
            units.push({ id: node.id, memberIds: [node.id, ...children.map((child) => child.id)], x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top });
            continue;
        }
        // 已经被算进某个分组单元的成员不再单独成单元
        if (node.metadata?.groupId && members.has(node.metadata.groupId)) continue;
        units.push({ id: node.id, memberIds: [node.id], x: node.position.x, y: node.position.y, width: node.width, height: node.height });
    }
    return units;
}

/**
 * 最长路径分层：无入边的在第 0 列，其余取「前驱最大层 + 1」。
 *
 * 连线理论上是 DAG，但插件或历史数据可能造出环，所以用固定轮数的松弛而不是递归——
 * 成环时最多跑 n 轮就停，不会死循环。
 */
function layerUnits(units: Unit[], connections: CanvasConnection[], unitOfNode: Map<string, string>) {
    const ids = new Set(units.map((unit) => unit.id));
    const edges: Array<[string, string]> = [];
    for (const connection of connections) {
        const from = unitOfNode.get(connection.fromNodeId);
        const to = unitOfNode.get(connection.toNodeId);
        // 丢掉自环：分组内部成员之间的连线折算后会变成单元指向自己
        if (!from || !to || from === to || !ids.has(from) || !ids.has(to)) continue;
        edges.push([from, to]);
    }

    const connected = new Set(edges.flat());
    const depth = new Map<string, number>(units.map((unit) => [unit.id, 0]));
    for (let round = 0; round < units.length; round += 1) {
        let changed = false;
        for (const [from, to] of edges) {
            const next = (depth.get(from) || 0) + 1;
            if (next > (depth.get(to) || 0)) {
                depth.set(to, next);
                changed = true;
            }
        }
        if (!changed) break;
    }

    const columns = new Map<number, Unit[]>();
    const orphans: Unit[] = [];
    for (const unit of units) {
        if (!connected.has(unit.id)) {
            orphans.push(unit);
            continue;
        }
        const level = depth.get(unit.id) || 0;
        columns.set(level, [...(columns.get(level) || []), unit]);
    }

    // 列内按当前中心 Y 排序，保住用户的心理位置感——整理不该把上下关系也打乱
    for (const list of columns.values()) list.sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2));
    orphans.sort((a, b) => a.y - b.y || a.x - b.x);

    return { columns, orphans };
}

function placeUnits(columns: Map<number, Unit[]>, orphans: Unit[]): Unit[] {
    const placed: Unit[] = [];
    const levels = [...columns.keys()].sort((a, b) => a - b);

    // 每列围绕同一条中轴垂直居中，链路看起来是平的而不是阶梯状
    const columnHeights = levels.map((level) => {
        const list = columns.get(level) || [];
        return list.reduce((sum, unit) => sum + unit.height, 0) + Math.max(0, list.length - 1) * ROW_GAP;
    });
    const tallest = Math.max(0, ...columnHeights);

    let cursorX = 0;
    let layeredBottom = 0;
    levels.forEach((level, index) => {
        const list = columns.get(level) || [];
        const columnWidth = Math.max(0, ...list.map((unit) => unit.width));
        let cursorY = (tallest - columnHeights[index]) / 2;
        for (const unit of list) {
            // 单元在列内水平居中，宽窄不一时不会左对齐显得毛糙
            placed.push({ ...unit, x: cursorX + (columnWidth - unit.width) / 2, y: cursorY });
            cursorY += unit.height + ROW_GAP;
            layeredBottom = Math.max(layeredBottom, cursorY - ROW_GAP);
        }
        cursorX += columnWidth + COLUMN_GAP;
    });

    // 没有任何连线的单元收到下方铺网格，不和链路混在一起
    if (orphans.length) {
        const cellWidth = Math.max(0, ...orphans.map((unit) => unit.width)) + COLUMN_GAP;
        const top = placed.length ? layeredBottom + SECTION_GAP : 0;
        let rowTop = top;
        let rowHeight = 0;
        orphans.forEach((unit, index) => {
            const column = index % ORPHAN_COLUMNS;
            if (column === 0 && index > 0) {
                rowTop += rowHeight + ROW_GAP;
                rowHeight = 0;
            }
            placed.push({ ...unit, x: column * cellWidth, y: rowTop });
            rowHeight = Math.max(rowHeight, unit.height);
        });
    }

    return placed;
}

function boundsOfUnits(units: Unit[]) {
    return units.reduce(
        (acc, unit) => ({
            left: Math.min(acc.left, unit.x),
            top: Math.min(acc.top, unit.y),
            right: Math.max(acc.right, unit.x + unit.width),
            bottom: Math.max(acc.bottom, unit.y + unit.height),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
}
