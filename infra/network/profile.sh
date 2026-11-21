#!/bin/sh
# Runs inside a disposable app node with CAP_NET_ADMIN. Resolve the WSS route
# on that node; a second NIC on the hub goes to the database.
set -eu
peer=${1:?peer on the lab data network}
profile=${2:?N0, N1, N2, cut, show or reset}
addr=$(getent hosts "$peer" | awk 'NR==1 {print $1}')
iface=$(ip -4 route get "$addr" | awk '{for(i=1;i<NF;i++) if($i=="dev"){print $(i+1); exit}}')
case "$iface" in ''|lo) echo 'No non-loopback data route' >&2; exit 2;; esac
active=$(tc qdisc show dev "$iface")
case "$profile" in
  show) ;;
  reset|N0)
    case "$active" in
      *"netem 4d4d:"*) tc qdisc del dev "$iface" root;;
      *"noqueue 0:"*) ;;
      *) echo "Unowned qdisc on $iface: $active" >&2; exit 2;;
    esac;;
  N1|N2|cut)
    case "$active" in *"noqueue 0:"*) ;; *) echo "Refusing to overwrite $active" >&2; exit 2;; esac
    case "$profile" in
      N1) set -- delay 150ms;;
      N2) set -- delay 150ms 20ms loss 5%;;
      cut) set -- loss 100%;;
    esac
    tc qdisc add dev "$iface" root handle 4d4d: netem "$@";;
  *) exit 2;;
esac
ip -4 route get "$addr"
tc -s qdisc show dev "$iface"
