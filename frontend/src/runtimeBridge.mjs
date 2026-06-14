export function hasWailsRuntime(scope = globalThis) {
  return Boolean(
    scope &&
      typeof scope === "object" &&
      scope.runtime &&
      scope.go?.main?.App
  );
}
