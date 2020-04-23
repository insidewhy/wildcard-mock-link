# wildcard-mock-link

[![build status](https://circleci.com/gh/insidewhy/wildcard-mock-link.png?style=shield)](https://circleci.com/gh/insidewhy/wildcard-mock-link)
[![Known Vulnerabilities](https://snyk.io/test/github/insidewhy/wildcard-mock-link/badge.svg)](https://snyk.io/test/github/insidewhy/wildcard-mock-link)
[![Renovate](https://img.shields.io/badge/renovate-enabled-brightgreen.svg)](https://renovatebot.com)

WildcardMockLink is a replacement for `MockLink` which can:

- Match requests with any variables.
- Provide mocks that match more than one request.
- Mock subscriptions and push out subscription responses during a test via method calls.
- Grab the latest mutation/query/subscription for use in test assertions.

## Documentation

### Wildcard queries

The `MockLink` provided with apollo requires the variables for every matching query to be specified ahead of time. In certain circumstances this is not convenient, i.e. using the `MockedProvider` in storybooks. `WildcardMockLink` allows mocks to be specified that match a query with any variables, and these mocks can be configured to match more than once.

```typescript
const SIMPLE_QUERY = gql`
  query($catName: String!) {
    qualities(cats: $catName) {
      loveliness
    }
  }
`

const link = new WildcardMockLink([
  {
    request: {
      query: SIMPLE_QUERY,
      variables: MATCH_ANY_PARAMETERS,
    },
    result: { data },
    nMatches: 2,
  },
])

return (
  <MockedProvider link={link}>
    <MyCatComponent />
  </MockedProvider>
)
```

The above mocked provider will match two requests for `SIMPLE_QUERY` no matter what the variables are due to `nMatches: 2`. If `nMatches` is omitted then the mock will match an infinite number of requests.

### Asserting against the latest request/mutation/subscription.

The following returns true if the last query matches `SIMPLE_QUERY`.

```typescript
link.lastQueryMatches(SIMPLE_QUERY)
```

There is also `lastMutationMatches` and `lastSubscriptionMatches`.

### Waiting for the latest response to return data

```typescript
await link.waitForLastResponse()
```

This can be used to ensure updates don't happen outside of `act`.

### Testing hooks

This library provides a utility function `hookWrapperWithApolloMocks` for creating a wrapper object which can be used with `@testing-library/react-hooks`. It returns a `WildcardMockLink` and a `wrapper` and can be used in conjunction with the functionality mentioned above to create a test like this:

```typescript
const SIMPLE_QUERY = gql`
  query($catName: String!) {
    qualities(cats: $catName) {
      loveliness
    }
  }
`

it('for a single request', async () => {
  const useQueryOnce = (catName: string) => {
    const { data } = useQuery(SIMPLE_QUERY, { variables: { catName } })
    return data
  }

  const data = {
    qualities: {
      __typename: 'Qualities',
      loveliness: 'very',
    },
  }
  const { wrapper, link } = hookWrapperWithApolloMocks([
    {
      request: {
        query: SIMPLE_QUERY,
        variables: MATCH_ANY_PARAMETERS,
      },
      result: { data },
    },
  ])
  const rendered = renderHook(() => useQueryOnce('tortand'), { wrapper })
  await act(() => link.waitForLastResponse())
  expect(link.lastQueryMatches(SIMPLE_QUERY)).toBeTruthy()
  expect(link.lastQuery!.variables).toEqual({ catName: 'tortand' })
  expect(rendered.result.current).toEqual(data)
})
```
