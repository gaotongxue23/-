# AI 八字命理工作台

基于 [defineS6/soothsay](https://github.com/defineS6/soothsay) 二次开发的自托管八字命理工作台。这个版本保留原项目的本地生辰档案、BYOK 模型凭据、多大师角色和管理后台，并新增面向命理师/深度用户的专业报告、流派会诊、人生事件线和报告导出能力。

当前版本：`0.3.0`

## 核心功能

- 八字排盘：支持公历、农历、直接四柱输入、真太阳时经度校正、子时换日与起运时间基准选择。
- 专业报告：一键生成可交付的结构化八字报告，覆盖命局底盘、事业、财运、关系、健康、大运流年和行动清单。
- 流派会诊：用传统子平、调候、盲派应事、心理现实派四个观察席生成共识、分歧和综合建议。
- 人生事件线：在个人档案中记录关键年份事件，后续报告会把它作为验盘和现实校验材料。
- 事实引用：AI 关键判断被要求标注依据，只能引用命理事实层、个人档案和人生事件线。
- 报告导出：当前解读可导出为 Markdown，便于继续整理成 PDF 或咨询记录。
- 多大师/多体系：内置道家、佛家、心理学派、子平格局派、盲派应事派；后台可继续创建自定义角色和体系。
- 隐私边界：用户模型凭据、生辰档案、人生事件和对话记录存储在浏览器本地；服务端只保存部署者管理的角色、体系和图片。

## 技术栈

- 前端：Vue 3、TypeScript、Vite
- 后端：Hono、Node.js
- 排盘：`lunar-javascript`
- 图标：`lucide-vue-next`
- 可选持久化：PostgreSQL

## 本地开发

```bash
pnpm install
pnpm dev
```

另开一个终端启动服务端：

```bash
pnpm dev:server
```

常用校验：

```bash
pnpm test
pnpm build
```

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `PORT` | 服务端口，默认 `8787` |
| `ADMIN_USERNAME` | 管理后台用户名 |
| `ADMIN_PASSWORD` | 管理后台密码 |
| `SOOTHSAY_DATA_DIR` | 文件存储目录，默认容器内 `/data` |
| `SOOTHSAY_PG_DSN` | 可选，PostgreSQL DSN，优先级最高 |
| `DATABASE_URL` | 可选，兼容 Render、Vercel 等平台的 PostgreSQL 连接串 |
| `POSTGRES_DSN` | 可选，备用 PostgreSQL 连接串 |
| `PGSSLMODE` | 可选，设为 `require` 启用 PostgreSQL SSL |

不要提交 `.env` 文件。用户的模型 `base_url`、`key`、命盘、人生事件、语言偏好和对话记录默认保存在浏览器本地。

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

Vercel/Render 也可以部署。若需要长期保存后台角色修改和上传图片，请配置 PostgreSQL；否则平台无持久磁盘时只能加载内置角色。

## 二开路线

第一版已经落地：

- 专业报告
- 流派会诊
- 人生事件线
- 事实依据约束
- Markdown 导出
- 子平格局派与盲派应事派

后续适合继续扩展：

- 合盘/亲子/合作关系模块
- 命理师客户管理与订单记录
- 报告模板库和 PDF 渲染
- 大运流年事件复盘看板
- 用户端/咨询师端分离

## 来源与许可

本项目基于 `defineS6/soothsay` 的 MIT 许可二次开发，保留其自托管、BYOK 和隐私优先的产品模式。原始许可见 [LICENSE](LICENSE)。
