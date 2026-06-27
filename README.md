# 八字命理学

当前版本：`0.5.0`

基于 [defineS6/soothsay](https://github.com/defineS6/soothsay) 二次开发的八字命理工作台，保留本地命盘、BYOK 模型凭据、多大师角色和后台管理模式，并增强了移动端解读体验、五行排盘展示、聊天记录和模型接入能力。

## 0.5.0 更新

- 新增商业化壳：命盘速览免费，专业报告、流派会诊、每日运势和今日抽签加入明确的权益与解锁状态。
- 新增大师会员体系：支持月卡、年卡、Pro 三档展示，提供桌面端入口、手机端“我的”入口、会员弹窗和横向权益对比。
- 优化移动端商业入口：命盘页仅保留“命盘速览”引导，首页和解读页保留完整服务入口，减少看盘时的干扰。
- 完善对话权益：AI 追问默认免费 2 次，超出后引导开通会员；聊天记录继续以对话形式保留。
- 完善专业排盘：出生地选择、经纬度、真太阳时校正和相关排盘事实进入命盘上下文。
- 修复大师解读事实缺失：提示词现在会明确携带性别、出生地、真太阳时和起运规则，降低大师误判“无法确认性别”的概率。
- 优化报告交付层：命盘速览、专业报告、流派会诊、每日运势、今日抽签和追问分别使用不同交付规格。
- 优化会员弹窗与手机端“我的”页：关闭按钮改为 X，会员页适配手机布局，“我的”页删除冗余标题，整体更轻。

## 0.4.0 更新

- 移动端解读页改为对话式体验：大师信息头部、聊天气泡、横向快捷问题和底部输入框。
- 首页“今日解读”可直接跳转到解读页，不再让用户误以为卡住。
- 删除移动端首页“最近摘要”模块，首页更聚焦命盘和发起解读。
- 凭据设置简化为 `base_url` + `key`，模型通过服务商接口解析后下拉选择。
- 后端代理支持 OpenAI Chat Completions 和 OpenAI Responses API 的自动兼容。
- 新增 `scripts/test-llm.mjs`，可用最小“你好”请求测试模型服务商是否可用。

## 核心功能

- 八字排盘：支持公历、农历、直接四柱输入、真太阳时经度校正、子时换日与起运时间基准选择。
- 专业报告：生成结构化八字报告，覆盖命局底盘、事业、财运、关系、健康、大运流年和行动清单。
- 流派会诊：模拟传统子平、调候、盲派应事、心理现实派等观察角度。
- 对话解读：保留用户追问和大师回复，解读页以聊天形式连续展示。
- 模型 BYOK：用户自行配置模型服务商凭据，key 仅保存在本机浏览器。
- 后台管理：支持角色、体系、头像和背景资源维护。
- 报告导出：当前解读可导出为 Markdown。

## 本地开发

安装依赖：

```bash
pnpm install
```

启动前端：

```bash
pnpm dev
```

另开一个终端启动后端代理：

```bash
pnpm dev:server
```

本地访问：

```txt
http://127.0.0.1:5173/
```

常用校验：

```bash
pnpm test
pnpm build
```

## 模型接入

前台右上角钥匙图标进入“凭据设置”：

1. 填写 `base_url`
2. 填写 `key`
3. 点击“解析模型”
4. 选择模型
5. 保存并测试

推荐先使用标准 OpenAI Chat Completions 兼容服务商，例如 DeepSeek：

```txt
base_url: https://api.deepseek.com
model: deepseek-chat
```

更多说明见 [模型服务商接入说明](docs/model-providers.md)。

## 最小模型测试

不经过前端页面，直接用脚本发送“你好”：

```powershell
$env:LLM_BASE_URL="https://api.deepseek.com"
$env:LLM_API_KEY="你的key"
$env:LLM_MODEL="deepseek-chat"
$env:LLM_PROTOCOL="chat"
$env:LLM_PROMPT="你好"
node scripts/test-llm.mjs
```

如果脚本能返回一句回复，说明服务商、key、模型和协议可用。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `PORT` | 服务端口，默认 `8787` |
| `ADMIN_USERNAME` | 管理后台用户名 |
| `ADMIN_PASSWORD` | 管理后台密码 |
| `SOOTHSAY_DATA_DIR` | 文件存储目录，容器内默认 `/data` |
| `SOOTHSAY_PG_DSN` | 可选，PostgreSQL DSN，优先级最高 |
| `DATABASE_URL` | 可选，兼容 Render、Vercel 等平台的 PostgreSQL 连接串 |
| `POSTGRES_DSN` | 可选，备用 PostgreSQL 连接串 |
| `PGSSLMODE` | 可选，设为 `require` 启用 PostgreSQL SSL |

不要提交 `.env` 或真实密钥。用户模型凭据、命盘和对话记录属于浏览器本地数据；代理接口不得记录 Authorization、请求正文或响应正文。

## 部署

Docker：

```bash
docker build -t bazi-workbench:latest .
docker run -d \
  --name bazi-workbench \
  -p 8787:8787 \
  -v bazi-workbench-data:/data \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD='change-me' \
  bazi-workbench:latest
```

Vercel/Render 可参考 [部署说明](docs/deployment.md)。如果需要长期保存后台角色、体系和上传图片，请配置 PostgreSQL。

## 来源与许可

本项目基于 `defineS6/soothsay` 的 MIT 许可二次开发，保留自托管、BYOK 和隐私优先的产品模式。原始许可见 [LICENSE](LICENSE)。
