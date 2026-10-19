# 基于 MongoDB 的问卷系统

第一阶段课程项目。网页支持注册登录、问卷创建和发布、四种题目输入形式、条件跳转、匿名或实名提交、重复提交控制及统计。单选统计分别显示去重填写人数和答卷次数。网页界面使用原生 HTML/CSS/JavaScript；服务器使用 Node.js 和 MongoDB 官方驱动。

## 本地运行

本项目已在 Node.js 23.11.0 和 MongoDB 8.3.11 上验证。先启动 MongoDB，再启动网页服务器。

```bash
npm ci
mkdir -p .mongo-data
mongod --dbpath .mongo-data --bind_ip 127.0.0.1 --port 27017
```

在另一个终端执行：

```bash
npm start
```

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)。默认数据库连接为 `mongodb://127.0.0.1:27017`，数据库名为 `survey_course`。可以设置环境变量 `MONGODB_URI`、`DB_NAME`、`PORT` 和 `HOST`。例如 MongoDB 运行在 27018 端口时：

```bash
MONGODB_URI=mongodb://127.0.0.1:27018 npm start
```

默认只监听本机。若要在局域网内演示，可设置 `HOST=0.0.0.0`，并通过服务器的实际地址打开网页；分享链接会使用浏览器当前访问的域名或 IP。公开互联网部署还需配置 HTTPS、网络访问和数据库连接。

局域网和公网的具体部署步骤见 [部署指南.md](./部署指南.md)。仓库已提供 Docker Compose、MongoDB 内部网络和 Caddy HTTPS 配置。

## 使用顺序

1. 注册或登录。
2. 新建问卷，设置标题、说明、截止时间、是否允许匿名、是否允许重复提交。
3. 添加题目、选项、校验条件和跳转规则；保存后发布。
4. 复制问卷链接。填写者登录后作答，可在允许匿名时选择匿名提交。
5. 创建者在“统计结果”中查看选项次数、填空内容、数字平均值和提交记录。

问卷发布后锁定标题、说明、题目和设置，但可以关闭。超过截止时间或关闭后不能再提交。

## MongoDB 结构

| 集合 | 主要数据 | 索引 |
| --- | --- | --- |
| `users` | 用户名、密码哈希、注册时间 | 用户名唯一 |
| `sessions` | 登录令牌的哈希、用户 ID、到期时间 | 令牌哈希唯一、到期 TTL |
| `surveys` | 创建者 ID、标题、说明、配置、状态、分享代码、题目数组 | 创建者与创建时间、分享代码唯一 |
| `responses` | 问卷 ID、填写者 ID、匿名标记、答案、提交时间 | 问卷与提交时间、不允许重复时的去重键唯一 |

题目随问卷一起保存，因为编辑和填写通常需要整份问卷。提交记录单独保存，避免问卷文档随填写人数增长。`respondentId` 始终存储在 MongoDB；创建者查询匿名提交时，接口只返回“匿名”，不会返回该用户 ID 或用户名。实名提交可以显示用户名。不允许重复提交的问卷使用唯一去重键，防止同时发起两次请求绕过限制。

## 主要接口

| 方法与路径 | 功能 |
| --- | --- |
| `POST /api/register`、`POST /api/login`、`POST /api/logout` | 注册、登录、退出 |
| `GET /api/me` | 当前登录用户 |
| `GET /api/surveys`、`POST /api/surveys` | 自己的问卷列表、创建问卷 |
| `GET /api/surveys/:id`、`PATCH /api/surveys/:id` | 查看或修改自己的草稿 |
| `PUT /api/surveys/:id/questions` | 保存草稿题目 |
| `POST /api/surveys/:id/publish`、`POST /api/surveys/:id/close` | 发布、关闭 |
| `GET /api/public/surveys/:slug`、`POST /api/public/surveys/:slug/responses` | 读取已发布问卷、提交答案 |
| `GET /api/surveys/:id/stats` | 整份问卷统计 |
| `GET /api/surveys/:id/questions/:questionId/stats` | 单题统计 |

私有问卷接口只允许创建者访问。后端还会检查填写者登录状态、问卷是否开放、题目必答与范围、跳转路径和重复提交规则。

## 测试

测试会连接 MongoDB，并创建随后删除的独立测试数据库。若 MongoDB 不在 27018 端口，请设置 `TEST_MONGODB_URI`：

```bash
TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm test
```

测试覆盖注册、权限、创建与发布问卷、题目保存、条件跳转、服务端校验、匿名身份保护、实名显示、并发重复提交、自动统计和关闭问卷。在项目目录执行 `npm test` 即可运行测试；测试需要先启动 MongoDB。
