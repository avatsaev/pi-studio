#!/bin/sh
# A stand-in for the `pi-studio` CLI, driven by the environment:
#   FAKE_PI_DIR      directory of the state file `running` and the logs `calls`, `starts`, `pid` (required)
#   FAKE_PI_VERSION  what `--version` prints (default 0.0.120)
#   FAKE_PI_PORT     the port it reports (default 6767)
#   FAKE_PI_MODE     garbage | sleep | not_healthy | slow (0.4 s per call, for overlap checks)
dir=$FAKE_PI_DIR
if [ "$1" = "--version" ]; then
    echo "${FAKE_PI_VERSION:-0.0.120}"
    exit 0
fi
[ "$1" = "--json" ] && [ "$2" = "daemon" ] || exit 2
cmd=$3
port=${FAKE_PI_PORT:-6767}
echo "begin $cmd" >> "$dir/calls"
echo $$ > "$dir/pid"
case ${FAKE_PI_MODE:-} in
    garbage) echo "this is not json"; echo "end $cmd" >> "$dir/calls"; exit 0 ;;
    sleep) sleep 30 ;;
    slow) sleep 0.4 ;;
esac
up() { printf '{"up":true,"host":"127.0.0.1","port":%s,"pairingUrl":"pi://S3CRET-CLI-PAIRING-5c1e90"}\n' "$port"; }
case $cmd in
    status)
        if [ -f "$dir/running" ]; then up; else echo '{"up":false}'; fi ;;
    start)
        if [ "${FAKE_PI_MODE:-}" = not_healthy ]; then
            echo '{"up":false}'
        else
            [ -f "$dir/running" ] || echo start >> "$dir/starts"
            touch "$dir/running"
            up
        fi ;;
    restart)
        echo restart >> "$dir/starts"
        touch "$dir/running"
        up ;;
    stop)
        rm -f "$dir/running"
        echo '{"stopped":true}' ;;
esac
echo "end $cmd" >> "$dir/calls"
