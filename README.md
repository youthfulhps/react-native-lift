# react-native-lift

Lift the real view into an overlay on long-press (teleport, no clone) with an RN-drawn context menu

## Installation


```sh
npm install react-native-lift
```


## Usage


```js
import { multiply } from 'react-native-lift';

// ...

const result = multiply(3, 7);
```


## Known limitations

### Android: one tap ignored after a long press on `VideoView`

On Android, after a long press that starts on an expo-video `VideoView` (`nativeControls={false}`), the next single tap anywhere in the app is ignored. Later taps work.

- **Cause:** react-native-gesture-handler intercepts the long press, then sends a cancel for that touch when the next tap starts. `VideoView` forwards that cancel to JS itself, and the cancel ends the new tap. This applies to any native view that forwards its own touches to JS. A `WebView` is not affected.
- **Not caused by lifting:** any react-native-gesture-handler long press on a `VideoView` does the same, without react-native-lift.
- **Workaround:** wrap the video in `<View pointerEvents="none">`. **Side effect:** the `VideoView` then receives no touches at all, lifted or not. Taps on the video itself do nothing.

## Contributing

- [Development workflow](CONTRIBUTING.md#development-workflow)
- [Sending a pull request](CONTRIBUTING.md#sending-a-pull-request)
- [Code of conduct](CODE_OF_CONDUCT.md)

## License

MIT

---

Made with [create-react-native-library](https://github.com/callstack/react-native-builder-bob)
