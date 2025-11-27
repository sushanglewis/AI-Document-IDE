
# online文档编辑工具
通过trae agent工具类实现以下工具，从而让trae agent具备对online文档的创建、修改、查询能力
注意，所有接口的userID入参值固定使用 "user"
## 创建文档
curl --location --request POST 'http://10.0.2.34:7876/ai/report/add' \
--header 'User-Agent: trae-agent' \
--header 'Content-Type: application/json' \
--header 'Connection: keep-alive' \
--data-raw '{
    "userId": "user",
    "title": "根据用户需求，让LLM为文档生成title，用<h1>包裹",
    "content": "根据用户需求，让LLM为文档生成content，使用HTML标签进行格式化（h1, h2, ul, li, table等）",
    "description": "让LLM根据用户需求，为文档生成文档摘要"
}'

## 获取文档详情信息
curl --location --request POST 'http://10.0.2.34:7876/ai/report/detail' \
--header 'User-Agent: trae-agent' \
--header 'Content-Type: application/json' \
--header 'Connection: keep-alive' \
--data-raw '{
    "documentId": "online文档的documentID",
    "userId": "user"
}'

## 编辑文档
curl --location --request POST 'http://10.0.2.34:7876/ai/report/edit' \
--header 'User-Agent: trae-agent' \
--header 'Content-Type: application/json' \
--header 'Connection: keep-alive' \
--data-raw '{
    "userId": "user",
    "title": "若用户需求中包含修改标题，则根据用户需求，让LLM为文档生成title来传入。否则，不传递此参数",
    "content": "根据用户需求，LLM生成的新内容",
    "documentId": "要修改的online文档的documentID"

}'