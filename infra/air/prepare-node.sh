#!/bin/sh
# Only run on a dedicated Air VM with eth0 for OOB SSH and eth1 for WSS.
set -eu
action=${1:?inspect, deploy, cut-data or restore-data}
role=${2:?hub or agent-a/b/c}
lab=${3:?lab identifier}
image=${4:?application image}
revision=${5:?source revision}
management_peer=${6:?SSH client address}
case "$role" in hub) host=10;; agent-a) host=11;; agent-b) host=12;; agent-c) host=13;; *) exit 2;; esac
case "$lab" in ''|*[!a-z0-9-]*) exit 2;; esac

ip link show eth1 >/dev/null
management_route=$(ip route get "$management_peer")
management_interface=$(printf '%s\n' "$management_route" | awk '{for(i=1;i<NF;i++) if($i=="dev"){print $(i+1); exit}}')
if [ "$management_interface" != eth0 ] || ip -4 route show default dev eth1 | grep -q .; then
  echo 'Expected OOB SSH on eth0 and no default route on eth1' >&2
  exit 1
fi
address="10.76.4.$host/24"
if ip -4 -o address show dev eth1 | awk '{print $4}' | grep -qvxF "$address"; then
  echo 'eth1 already has an unrelated IPv4 address' >&2
  exit 1
fi
if ip -4 route show 10.76.4.0/24 | grep -qv 'dev eth1'; then
  echo 'The requested data subnet overlaps another interface' >&2
  exit 1
fi
case "$action" in
  inspect)
    sed -n 's/^PRETTY_NAME=//p' /etc/os-release
    uname -srvmo
    docker version --format '{{.Server.Version}}'
    ip -4 -o address show dev eth1
    exit 0;;
  cut-data|restore-data)
    if ! ip -4 -o address show dev eth1 | awk '{print $4}' | grep -qxF "$address"; then
      echo 'The data interface is missing the expected lab address' >&2
      exit 1
    fi
    link=up
    if [ "$action" = cut-data ]; then link=down; fi
    ip link set eth1 "$link"
    ip -s link show dev eth1
    exit 0;;
esac
[ "$action" = deploy ] || exit 2
observed=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")
if [ "$observed" != "$revision" ]; then echo 'Application image revision differs from inventory' >&2; exit 1; fi

ip link set eth1 up
ip address replace "$address" dev eth1
name="meetmesh-air-$lab"
expected=$(docker image inspect --format '{{.Id}}' "$image")
if docker container inspect "$name" >/dev/null 2>&1; then
  owner=$(docker container inspect --format '{{index .Config.Labels "org.meetmesh.air.role"}} {{.Image}}' "$name")
  if [ "$owner" != "$role $expected" ]; then echo 'Existing container does not match inventory' >&2; exit 1; fi
else
  docker create --name "$name" --init --network host --cap-add NET_ADMIN \
    --label "org.meetmesh.air.role=$role" --add-host hub-data:10.76.4.10 --add-host agent-a:10.76.4.11 \
    --env MEETMESH_DATA_HOST=hub-data --volume "$name-state:/state" "$image" >/dev/null
fi
docker start "$name" >/dev/null
