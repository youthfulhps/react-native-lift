// Metro inlines EXPO_PUBLIC_* at bundle time; the example has no @types/node.
declare const process: { env: Record<string, string | undefined> };
