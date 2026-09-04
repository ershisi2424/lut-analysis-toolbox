#!/bin/zsh

set -u

SCRIPT_DIR="${0:A:h}"
SERVER_PORT=4174
PID_FILE="$SCRIPT_DIR/.lut-analysis-toolbox-server.pid"
LOG_FILE="$SCRIPT_DIR/lut-analysis-toolbox-server.log"
SERVER_URL="http://127.0.0.1:${SERVER_PORT}/"

cd -- "$SCRIPT_DIR" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  echo "未找到 python3，无法启动本地网页服务。"
  read -r "?按回车键关闭窗口..."
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  EXISTING_PID="$(<"$PID_FILE")"
  if [[ "$EXISTING_PID" == <-> ]] && kill -0 "$EXISTING_PID" 2>/dev/null && \
     lsof -nP -a -p "$EXISTING_PID" -iTCP:"$SERVER_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "LUT分析工具箱已在运行：$SERVER_URL"
    open "$SERVER_URL"
    exit 0
  fi
  rm -f -- "$PID_FILE"
fi

if lsof -nP -iTCP:"$SERVER_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "端口 $SERVER_PORT 已被其他程序占用，未启动。"
  read -r "?按回车键关闭窗口..."
  exit 1
fi

nohup python3 -m http.server "$SERVER_PORT" --bind 127.0.0.1 >"$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" >"$PID_FILE"

for _ in {1..30}; do
  if lsof -nP -a -p "$SERVER_PID" -iTCP:"$SERVER_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "LUT分析工具箱已启动：$SERVER_URL"
    open "$SERVER_URL"
    exit 0
  fi
  sleep 0.1
done

echo "启动失败，请查看：$LOG_FILE"
rm -f -- "$PID_FILE"
read -r "?按回车键关闭窗口..."
exit 1
