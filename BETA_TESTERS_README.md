# Installation and configuration

Install pi-studio cli

`npm i -g @av-pi-studio/cli`

install molagent skills

`pi-studio pi install git:git@github.com:avatsaev/pi-molagent`

### Setup LLM provider

#### Run pi agent TUI first

`pi-studio pi`

in the tui type the following command to setup your provider via API key or login into a subscription (ex: anthropic)

`/login`

Check the the provider works by selecting a model `/models` and seding a message

Ctrl+C twice to exit the TUI once provider is connected and tested

---

## Start the pi-studio server in relay mode

- `PI_STUDIO_RELAY_ENABLED=true PI_STUDIO_RELAY_ENDPOINT=relay.molagent.ai PI_STUDIO_RELAY_USE_TLS=true pi-studio daemon start`

this will intialize the server in relay mode so you can access the server via the UI from anywhere, relay settings are saved so next time you start the server you don't need to specify the relay config:

`pi-studio daemon start` will automatically start en relay mode

Click the displayed link to start working in the PI-Studio UI

---

### Update pi-studio

just run

`pi-studio update`

restart the server

`pi-studio daemon restart`

#### update molagent skills:

`pi-studio pi update --extensions`

