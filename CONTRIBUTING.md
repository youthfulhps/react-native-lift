# Contributing

Thanks for helping. Bug reports with a minimal reproduction and focused pull requests are the most useful.

## Setup

- Node from [`.nvmrc`](.nvmrc) (`nvm use`).
- Yarn 4, pinned in `package.json` (`corepack enable`, then `yarn`).
- For the example app: Xcode with an iOS simulator, and/or Android Studio with an emulator.

```sh
yarn
```

This installs the library and the example app (a Yarn workspace).

## Run the example app

The example is an Expo app with a development build (react-native-teleport has native code, so Expo Go does not work).

```sh
yarn example ios       # builds and opens the iOS simulator
yarn example android   # builds and opens the Android emulator
```

After the first build, `yarn example start` starts Metro alone. Changes in `src/` show up in the example right away.

## Checks

```sh
yarn typecheck
yarn lint
yarn test
```

CI runs the same checks, plus a release build of the example on Android and iOS.

[Maestro](https://maestro.mobile.dev) flows live in `example/.maestro/`. With the example installed on a simulator or emulator:

```sh
maestro test example/.maestro/smoke.yaml
```

## Design rules

- **The real view moves, never a copy.** A lift moves the view into the overlay with react-native-teleport and back on drop. Nothing is mounted twice.
- **Engine and presentation stay apart.** `src/engine` (gesture, measuring, placement, the teleport) must not import `src/presentation` (menu, backdrop) or the components. ESLint enforces this.
- **Placement is a pure function.** Where the view, menu and accessory go is decided by `computeLayout` (`src/engine/computeLayout.ts`). Change placement rules there, with unit tests.
- **Animate on the UI thread, transform and opacity only.** Layout properties do not animate.
- **Keep the handoff path plain.** The frames where the view moves into the overlay and back must not gain animated components or extra layout passes. A one-frame jump there often shows only in a release build, so check lift and drop in release builds on both platforms when you touch it.
- **Small public API.** Open an issue before adding a prop or a hook.

## Pull requests

- One change per pull request. Pull requests are squash-merged, and the title becomes the commit message (`fix: …`, `feat: …`, `docs: …`). Releases come from these titles: [release-please](https://github.com/googleapis/release-please) keeps a release pull request open, and merging it tags the version and publishes to npm.
- Update the README when behavior or the API changes.
- Add a screen recording for visual changes.
- Report security issues privately, see [SECURITY.md](SECURITY.md).
