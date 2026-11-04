import {
  Component,
  Suspense,
  createContext,
  lazy,
  use,
  useCallback,
  useEffect,
  useState,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from "react";
import { Button, ScrollView, Text, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";

void SplashScreen.preventAutoHideAsync().catch(() => {});

const StartupReadyContext = createContext<(() => void) | null>(null);
type AppLoader = () => Promise<{ default: ComponentType }>;

export function useAppStartupReady(ready: boolean) {
  const onReady = use(StartupReadyContext);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reports preference hydration to the startup deadline owner
  useEffect(() => {
    if (ready) onReady?.();
  }, [onReady, ready]);
}

function startupDetails(error: unknown): string {
  const details: string[] = [];
  let cause = error;
  for (let depth = 0; depth < 4; depth++) {
    details.push(cause instanceof Error ? (cause.stack ?? cause.message) : String(cause));
    if (!(cause instanceof Error) || cause.cause === undefined) break;
    cause = cause.cause;
  }
  return details.join("\nCaused by: ");
}

interface StartupState {
  readonly failed: boolean;
  readonly error: unknown;
  readonly Root: LazyExoticComponent<ComponentType>;
  readonly attempt: number;
}

export class AppStartup extends Component<{ load: AppLoader }, StartupState> {
  override state: StartupState = {
    failed: false,
    error: null,
    Root: lazy(this.props.load),
    attempt: 0,
  };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error };
  }

  private readonly retry = () =>
    this.setState(({ attempt }) => ({
      failed: false,
      error: null,
      Root: lazy(this.props.load),
      attempt: attempt + 1,
    }));

  private renderContent(): ReactNode {
    if (!this.state.failed)
      return <StartupAttempt key={this.state.attempt} Root={this.state.Root} retry={this.retry} />;
    return (
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24, gap: 16 }}
      >
        <Text style={{ color: "#ededed", fontSize: 24 }}>T3 Code couldn't start</Text>
        <Text style={{ color: "#bdbdbd" }}>
          Retrying won't clear your saved connections or settings. Try again, or share these details
          when reporting the problem.
        </Text>
        <Button title="Try again" onPress={this.retry} />
        <Text selectable style={{ color: "#bdbdbd", fontSize: 12 }}>
          {startupDetails(this.state.error)}
        </Text>
      </ScrollView>
    );
  }

  override render() {
    return (
      <View
        style={{ flex: 1, backgroundColor: "#141414" }}
        onLayout={() => void SplashScreen.hideAsync().catch(() => {})}
      >
        {this.renderContent()}
      </View>
    );
  }
}

function StartupAttempt({ Root, retry }: { Root: ComponentType; retry: () => void }) {
  const [ready, setReady] = useState(false);
  const [expired, setExpired] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- offers recovery for stalled startup without interrupting slow native initialization
  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setExpired(true), 15_000);
    return () => clearTimeout(timer);
  }, [ready]);
  return (
    <StartupReadyContext.Provider value={onReady}>
      <Suspense fallback={null}>
        <Root />
      </Suspense>
      {!ready ? (
        <View
          style={{
            position: "absolute",
            inset: 0,
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "#141414",
            padding: 24,
            gap: 16,
          }}
        >
          <Text style={{ color: "#ededed", fontSize: 20 }}>
            {expired ? "T3 Code is taking longer to start" : "Starting T3 Code…"}
          </Text>
          {expired ? (
            <>
              <Text style={{ color: "#bdbdbd" }}>
                Startup has not finished. Retrying won't clear your saved connections or settings.
              </Text>
              <Button title="Try again" onPress={retry} />
            </>
          ) : null}
        </View>
      ) : null}
    </StartupReadyContext.Provider>
  );
}
