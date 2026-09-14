# 构建上下文是 canvas-server/ 目录本身。
FROM oven/bun:1.3.13

WORKDIR /app

COPY package.json ./
RUN bun install

COPY src ./src
COPY tsconfig.json ./

ENV DATA_DIR=/data
ENV PORT=8080
EXPOSE 8080

# SQLite 和用户文件都在 /data，备份这一个卷即可
VOLUME ["/data"]

CMD ["bun", "src/index.ts"]
