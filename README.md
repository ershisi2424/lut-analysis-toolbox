# LUT分析工具箱

一个离线运行的 3D LUT 检查、分析、预览与转换工具。项目同时支持浏览器本地运行和 Windows x64 便携 EXE。

当前版本：`1.1.0`
访问密码：`1820900463`

## 功能

- LUT 检查器：读取 `.cube` 文件，显示尺寸、范围、动态范围、对比度、曲线、色相分布、热力图和矢量示波器。
- LUT 分析器：提供独立的可见导入入口，检查中性轴、平滑度、饱和度响应和 IRE 响应。
- LUT 预览器：在内置图或用户图片上实时比较原图与 LUT 结果。
- LUT 转换：三线性、四面体和 Catmull-Rom 插值，支持 2～65 阶重采样、平滑、色域压缩与 `.cube` 导出。
- Hald CLUT：支持生成和读取标准方形 Hald 图。

## Windows 便携版

在 GitHub Releases 下载 `LUT-Analysis-Toolbox-1.1.0-portable.exe`，双击即可运行，无需安装 Node.js。

Windows 便携版由 GitHub Actions 在 `windows-latest` x64 环境中重新测试和构建。每个 Release 同时提供 `SHA256SUMS.txt`，可用于验证文件完整性。

## 源码运行

需要 Node.js 22.12 或更高版本：

```bash
npm ci
npm start
```

也可以使用静态 HTTP 服务打开网页版本，但不要直接双击 HTML；HTTP 服务才能正常使用 Service Worker 离线缓存。

## 测试与打包

```bash
# LUT 算法和项目完整性测试
npm test

# Electron 三页面端到端烟雾测试
npm run test:electron

# JavaScript 语法检查
npm run check

# 生成 Windows x64 便携 EXE
npm run dist:win
```

端到端测试会实际验证：错误密码被拒绝、正确密码登录、三个页面加载 3D LUT、分析数值、IRE 高 DPI 画布、结果图尺寸以及自定义 16:9 图片预览。

## LUT 数据约定

- `.cube` 支持 `LUT_3D_SIZE`、`DOMAIN_MIN`、`DOMAIN_MAX` 和 `LUT_3D_INPUT_RANGE`。
- 解析阶段保留超出 0～1 的浮点值，避免 HDR/扩展范围 LUT 被静默裁剪。
- 导出 `.cube` 时保留输入域元数据。
- Hald PNG 是 8 位图像格式，读取时只能恢复 0～1 范围数据，也不能携带 `.cube` 的 domain 元数据；这是格式限制。

## 安全说明

密码验证用于阻止普通页面访问，不等同于服务端安全认证。因为本项目完全离线运行，前端资源和便携程序的持有者仍可检查其中的代码。不要用它保护高敏感数据。

## 许可与来源

当前仓库未授予开源许可。请仅在你有权使用、复制和发布相关代码及资源的范围内使用本项目。
