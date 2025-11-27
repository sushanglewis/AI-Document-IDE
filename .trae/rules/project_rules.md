# Docker 部署规则

名称与端口
- 服务名称：document-ide（容器名），postgres（document-ide-postgres）
- 端口映射：8090->app、5432->postgres

工作目录挂载
- 挂载：/Users/stylesu/Documents/Heils/Agent/workspace 到容器 /workspace

重建与重启
- 重建并启动：`docker compose up -d --build`
- 停止并清理：`docker compose down`

数据库
- PostgreSQL 连接：`postgresql+psycopg://postgres:postgres@postgres:5432/trae`

每次执行完成后都重建重启docker收尾

