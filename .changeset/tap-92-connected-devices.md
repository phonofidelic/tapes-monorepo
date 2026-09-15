---
'@tapes-monorepo/sync-protocol': minor
'electron-client': minor
---

The desktop host now tracks who is connected to its sync server. It keeps a registry of open sockets, each with the name from the handshake, the remote address and the time it connected. Entries are added and removed on the server's own connection and close events, so the list cannot drift from the sockets the server holds. The main process exposes a snapshot getter and a change subscription. Nothing renders this yet.

Two cases would otherwise make the list lie. A LAN socket that goes away, such as a phone carried out of range, often never fires a close event. The registry pings every socket on a timer and terminates whatever stops answering, so a dead connection leaves the list within two intervals. And the host's own window is a peer of the server it runs, so it marks itself with `?h=1` on the upgrade request and is flagged as this machine rather than listed as a guest. The mark grants nothing and only counts from a loopback connection.
