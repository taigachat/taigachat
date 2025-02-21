# TaigaChat
![Client package.json Version](https://img.shields.io/github/package-json/v/taigachat/taigachat/master?filename=Client%2Fpackage.json&label=TaigaChat)
![GitHub License](https://img.shields.io/github/license/taigachat/taigachat?style=flat&label=License&color=%2332CD32)
![Commit Activity](https://img.shields.io/github/commit-activity/t/taigachat/taigachat?label=Commits)
![GitHub Issues](https://img.shields.io/github/issues/taigachat/taigachat?label=Issues)
![Created](https://img.shields.io/badge/Created-Mars%202021-%23EEE?style=flat)


![Web App](https://img.shields.io/website?url=https%3A%2F%2Fapp.taigachat.se&up_message=Reachable&down_message=Problems&label=Web%20App)
![Login Service](https://img.shields.io/website?url=https%3A%2F%2Flogin.taigachat.se%2F&up_message=Reachable&down_message=Problems&label=Login%20Service)

TaigaChat is the new all-in-one communications platform where decentralization meets practical use.
The mission of TaigaChat is to create a platform where users can easily & safely communicate with large groups of people, colloquially known as an online community.
For an online community to work in the long term sustainably, the community must be able to control all aspects of its community.
The current unfortunate status quo is that online tech giants are able to control, everything.
Leaving very little up to the individual to decide.
TaigaChat seeks to remedy this situation by giving back control.

## Contents
This monorepo contains both the client and the reference server implementation.
The code is licensed under AGPL-3.0 (for more information see the NOTICE file) but a private license can be obtained by contacting
[Alexander Björkman](https://github.com/sashabjorkman).

## Goals
The goal of TaigaChat is to be a decentralized chat-client.
Anyone should be able to self-host their own server.
And the standard should not be dependent on any central service nor any federated services.
Any centralized / federated service in TaigaChat is there purely for the convinience and practicality of those
that are less concious about their online presence.

## Current State
TaigaChat in its current state has:
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
should always start with `TAIGACHAT_SERVER_*` and the definitions (for the server) can be found
[here](Server/Source/config.ts).

Copyright © 2025, Alexander Björkman
