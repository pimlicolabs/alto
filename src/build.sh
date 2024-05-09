if [ -n "$SENTRY_AUTH_TOKEN" ]; then
  # Run your script or command here
  echo "Running script because SENTRY_AUTH_TOKEN is set and not empty"
  pnpm run compile-tsc
  pnpm run sentry:sourcemaps
  # Example: ./your_script.sh
else
  echo "SENTRY_AUTH_TOKEN is not set or empty"
  pnpm run compile-tsc
fi

