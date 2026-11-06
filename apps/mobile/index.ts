import { registerRootComponent } from 'expo';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
// Defines the background sync task; it must run before the app or the system starts it.
import './src/background.ts';
import App from './src/App.tsx';
import { widgetTaskHandler } from './src/widget/handler.tsx';

// Hermes lacks AbortSignal.timeout, which the shared client uses for its request timeout.
if (typeof AbortSignal.timeout !== 'function') {
  AbortSignal.timeout = (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('timed out')), ms);
    return controller.signal;
  };
}

registerRootComponent(App);
registerWidgetTaskHandler(widgetTaskHandler);
