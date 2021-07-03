# Changelog

- 2021/07/03 - 2.0.1

  - Pass graphql variables to result function.

- 2021/06/16 - 2.0.0

  - Add `suppressMissingMockWarnings` option.

- 2021/05/11 - 2.0.0-rc.6

  - Run `waitForAllResponsesRecursively` in single `act`.

- 2021/05/11 - 2.0.0-rc.5

  - Use `act` in `waitFor...` methods.
  - Make `hookWrapperWithApolloMocks` take `Wrap` as option property rather than second argument.

- 2021/05/11 - 2.0.0-rc.4

  - Make `nMatches` default to 1.
  - Allow `nMatches` to be used for non-wildcard matches.
  - Allow request window for `waitForAllResponsesRecursively` to be specified as argument.

- 2021/04/30 - 2.0.0-rc.3

  - Migrate to apollo client 3
  - Remove `addWildcardMockedResponse`, now `addMockedResponse` tests if the mocked response contains a wildcard before deciding what to do.

- 2020/04/22 - 1.0.0
  - Initial release.
