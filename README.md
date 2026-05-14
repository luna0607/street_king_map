# 街头小小小霸王地图 (Street King Map)

这是一个展示“街头小小小霸王”视频中打卡地点的互动地图。你可以通过这个项目方便地找到视频中提到的美食店、景点以及其他有趣的地点。

- **在线地址**: [luna0607.github.io/street_king_map/](https://luna0607.github.io/street_king_map/)
- **社交媒体**: [Bilibili](https://space.bilibili.com/3546636378703921) | [YouTube](https://www.youtube.com/@xdd18874)

## 功能特点

- **视频联动**: 地图上的每个标记点都对应一个视频，点击可查看视频详情和预览图。
- **互动管理**: 提供管理界面，方便用户添加、编辑或删除地点。
- **自动化贡献**: 结合 GitHub Actions，支持通过提交 Issue 的方式自动处理用户贡献的地点信息。

## 如何贡献

如果你发现了视频中新的打卡点，欢迎提交贡献！

1. **进入管理界面**: 点击地图右下角的“一起来完善地图吧！”或访问 [admin.html](admin.html)。
2. **添加/修改地点**: 在管理页面中找到对应的视频，添加新的地点标记或修改现有标记。
3. **导出贡献**: 完成编辑后，点击“导出贡献 (JSON)”下载 `contributions.json` 文件。
4. **提交 Issue**: 前往 GitHub [提交贡献 Issue](https://github.com/luna0607/street_king_map/issues/new?template=contribution.yml)，将导出的 JSON 内容粘贴到 Issue 中。
5. **自动处理**: 系统会自动运行机器人验证你的提交，并创建一个 Pull Request。合并后，你的贡献将出现在地图上。

## 本地开发

如果你想在本地运行项目或进行开发：

### 1. 克隆仓库
```bash
git clone https://github.com/luna0607/street_king_map.git
cd street_king_map
```

### 2. 启动开发服务器
项目自带一个简单的 Python 开发服务器，可以处理静态文件并支持保存地点数据。
```bash
python3 scripts/serve.py
```
启动后访问：
- **地图**: [http://127.0.0.1:8000/index.html](http://127.0.0.1:8000/index.html)
- **管理后台**: [http://127.0.0.1:8000/admin.html](http://127.0.0.1:8000/admin.html)
- **合并评审**: [http://127.0.0.1:8000/merge_review.html](http://127.0.0.1:8000/merge_review.html)

### 3. 数据合并 (手动)
如果你有 `contributions.json` 文件需要手动合并到主数据中：
```bash
python3 scripts/merge_contributions.py path/to/contributions.json
```

## 项目结构

- `data/`: 存放地点、视频元数据等 JSON 文件。
- `scripts/`: 用于数据处理、合并和服务器运行的 Python 脚本。
- `index.html`, `map.js`, `styles.css`: 地图主界面相关文件。
- `admin.html`, `admin.js`: 地点管理后台相关文件。
- `merge_review.html`, `merge_review.js`: 用于处理和评审地点合并的界面。

## 许可证

本项目遵循开源协议（如果未指定，默认为 MIT 或同等协议）。
