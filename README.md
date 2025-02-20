# TaigaChat
This repository contains source code
for the TaigaChat client. As well as source code for the reference
server implementation. The code is licensed under AGPL-3.0
(for more information see the NOTICE file)
but a private license can be obtained by contacting
[Alexander Björkman](https://github.com/sashabjorkman).

## What is TaigaChat?
TaigaChat is a decentralized chat-client. Anyone should be able to self-host their
own server. And the standard should not be dependent on any central service. Any
centralized service in TaigaChat is there purely for the convinience of those
that are less concious about their online presence.

TaigaChat in its current state has (a):
1. Voice Calls
2. Chat Rooms
3. Web Client
4. Push to Talk
5. S3 Attachments
6. Update Button
7. Server Profile Synchronization
8. Role-based Permissions System
9. Cryptographic Offline Login (UI is still lacking here)
10. Hosted Servers
11. Password-based E2E Encryption

For more information regarding the goals and design of TaigaChat navigate
to [taigachat.com](http://taigachat.com)

## Platform Support
TaigaChat is supported on the following platforms:
- Windows
- Linux
- Web
- Android (W.I.P)

In the future, hopefully more platforms will be added to this list.

## Screenshots
![main screen](https://taigachat.com/screenshots/main_screen.png)
![settings](https://taigachat.com/screenshots/settings.png)

## Contributing
If you have an idea for a feature or improvement, please create an issue
and discuss it first. In most cases, I would prefer to implement the feature
myself. However, I do not wish to discourage people from playing around with
the code - to the contrary, I would feel honoured if someone did.

## Installation
### Linux
Installation on Linux should be done via the AppImage
(which has not been realeased yet, but can easily be built).

### Web
Simply navigate to https://app.taigachat.se/ and optionally install
it as a PWA.

### Windows
A prebuilt Windows MSI file can be found [here](https://cdn.taigachat.se/versions/TaigaChat.msi).

### Server
To start the server simply cd into the server directory and run:
```
pnpm i
node --experimental-strip-types server.js
```
Configuration can be done by setting environment variables. These environment variables
should always start with `TAIGACHAT_*` and the definitions (for the server) can be found
[here](Server/Source/config.ts).

## Building
For building the project please see:
[Building The Client](Client/building.md)
[Building The Server](Server/building.md)

Copyright © 2025, Alexander Björkman

