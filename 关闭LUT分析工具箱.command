#!/bin/zsh

set -u

SCRIPT_DIR="${0:A:h}"
SERVER_PORT=4174
PID_FILE="$SCRIPT_DIR/.lut-analysis-toolbox-server.pid"

cd -- "$SCRIPT_DIR" || exit 1

if [[ ! -f "$PID_FILE" ]]; then
  echo "未发现由启动脚本创建的LUT分析工具箱服务。"
  read -r "?按回车键关闭窗口..."
  exit 0
fi

SERVER_PID="$(<"$PID_FILE")"
if [[ "$SERVER_PID" != <-> ]]; then
  echo "PID 文件无效，已清理；没有终止任何进程。"
  rm -f -- "$PID_FILE"
  read -r "?按回车键关闭窗口..."
  exit 1
fi

if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  rm -f -- "$PID_FILE"
  echo "服务已经停止。"
  read -r "?按回车键关闭窗口..."
  exit 0
fi

PROCESS_CWD="$(lsof -a -p "$SERVER_PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
if [[ "$PROCESS_CWD" != "$SCRIPT_DIR" ]] || \
   ! lsof -nP -a -p "$SERVER_PID" -iTCP:"$SERVER_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "PID 与当前目录或端口不匹配；为避免误关其他程序，没有终止。"
  read -r "?按回车键关闭窗口..."
  exit 1
fi

kill "$SERVER_PID"
for _ in {1..30}; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    rm -f -- "$PID_FILE"
    echo "LUT分析工具箱已关闭。"
    read -r "?按回车键关闭窗口..."
    exit 0
  fi
  sleep 0.1
done

echo "服务未能在预期时间内关闭；没有强制终止。"
read -r "?按回车键关闭窗口..."
exit 1
