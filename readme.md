# wildcard-mock-link

[![build status](https://circleci.com/gh/insidewhy/wildcard-mock-link.png?style=shield)](https://circleci.com/gh/insidewhy/wildcard-mock-link)
[![Known Vulnerabilities](https://snyk.io/test/github/insidewhy/wildcard-mock-link/badge.svg)](https://snyk.io/test/github/insidewhy/wildcard-mock-link)
[![Renovate](https://img.shields.io/badge/renovate-enabled-brightgreen.svg)](https://renovatebot.com)

`WildcardMockLink` is a replacement for `MockLink` which can:

- Match requests with arbitrary variables.
- Provide mocks that match more than one request.
- Mock subscriptions and push out subscription responses during a test via method calls.
- Grab the latest mutation/query/subscription for use in test assertions.

## Documentation

### Wildcard queries

The `MockLink` provided with apollo requires the variables for every matching query to be specified ahead of time. In certain circumstances this is not convenient, i.e. using the `MockedProvider` in storybook stories. `WildcardMockLink` allows mocks to be specified that match a query with any variables, and these mocks can be configured to match more than once.

```typescript
const CAT_QUALITIES_QUERY = gql`
  query($catName: String!) {
    qualities(cats: $catName) {
      loveliness
    }
  }
`

const link = new WildcardMockLink([
  {
    request: {
      query: CAT_QUALITIES_QUERY,
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

The above mocked provider will match two requests for `CAT_QUALITIES_QUERY` no matter what the variables are. Here `nMatches` is used to restrict the mock to the first two requests that match, when `nMatches` is omitted the mock will match an infinite number of requests.

### Asserting against the latest request/mutation/subscription.

The following returns true if the last query matches `CAT_QUALITIES_QUERY`.

```typescript
link.lastQueryMatches(CAT_QUALITIES_QUERY)
```

There is also `lastMutationMatches` and `lastSubscriptionMatches`.

### Waiting for the latest response to return data

```typescript
await link.waitForLastResponse()
```

This can be used to ensure updates don't happen outside of `act`.

### Testing components with mock data

This library provides a utility function `withApolloMocks` which can be used to created a component tree with access to mocked data. It returns the react element at the head of the component tree and a `WildcardMockLink` object and can be used in conjunction with the functionality mentioned above to create a test like this:

```typescript
import { useQuery } from '@apollo/react-hooks'
import { render, act } from '@testing-library/react'
import gql from 'graphql-tag'
import React, { FC } from 'react'
import {
  MATCH_ANY_PARAMETERS,
  hookWrapperWithApolloMocks,
} from 'wildcard-mock-link'

const CAT_QUALITIES_QUERY = gql`
  query($catName: String!) {
    qualities(cats: $catName) {
      loveliness
    }
  }
`

it('can be used to mock data for a component tree', async () => {
  const data = {
    qualities: {
      __typename: 'Qualities',
      loveliness: 'very',
    },
  }

  const { element, link } = withApolloMocks(
    () => <MyCatComponent catName="mr bad actor face" />,
    [
      {
        request: {
          query: CAT_QUALITIES_QUERY,
          variables: MATCH_ANY_PARAMETERS,
        },
        result: { data },
      },
    ],
  )
  const { getByRole } = render(element)
  await act(() => link.waitForLastResponse())

  expect(link.lastQueryMatches(CAT_QUALITIES_QUERY)).toBeTruthy()
  expect(link.lastQuery?.variables).toEqual({ catName: 'mr bad actor face' })
  const mainContent = getByRole('main')
  expect(mainContent?.textContent).toEqual('Loveliness: very')
})
```

### Testing hooks with mock data

This library provides a utility function `hookWrapperWithApolloMocks` for creating a wrapper object which can be used with `@testing-library/react-hooks`. It returns a `WildcardMockLink` and a `wrapper` and can be used in conjunction with the functionality mentioned above to create a test like this:

```typescript
import { useQuery } from '@apollo/react-hooks'
import { renderHook, act as actHook } from '@testing-library/react-hooks'
import gql from 'graphql-tag'
import {
  MATCH_ANY_PARAMETERS,
  hookWrapperWithApolloMocks,
} from 'wildcard-mock-link'

const CAT_QUALITIES_QUERY = gql`
  query($catName: String!) {
    qualities(cats: $catName) {
      loveliness
    }
  }
`

it('can be used to mock data for a hook', async () => {
  const useQueryOnce = (catName: string) => {
    const { data } = useQuery(CAT_QUALITIES_QUERY, { variables: { catName } })
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
        query: CAT_QUALITIES_QUERY,
        variables: MATCH_ANY_PARAMETERS,
      },
      result: { data },
    },
  ])
  const { result } = renderHook(() => useQueryOnce('tortand'), { wrapper })
  await act(() => link.waitForLastResponse())
  expect(link.lastQueryMatches(CAT_QUALITIES_QUERY)).toBeTruthy()
  expect(link.lastQuery!.variables).toEqual({ catName: 'tortand' })
  expect(result.current).toEqual(data)
})
```

### Testing subscriptions with multiple responses

The `WildcardMockLink` provides a way to push new responses out to subscriptions. This can be used during tests to make it easier to test how components respond to subscription updates. The `sendWildcardSubscriptionResult` method can be used to send a new response which matches a wildcard mock, otherwise `sendSubscriptionResult` can be used. Here is an example:

```typescript
import { useQuery } from '@apollo/react-hooks'
import { waitFor } from '@testing-library/react'
import { renderHook, act as actHook } from '@testing-library/react-hooks'
import gql from 'graphql-tag'
import {
  MATCH_ANY_PARAMETERS,
  hookWrapperWithApolloMocks,
} from 'wildcard-mock-link'

const MISCHIEF_SUBSCRIPTION = gql`
  subscription($catName: String!) {
    actsOfMischief(cats: $catName) {
      description
      severity
    }
  }
`

it('can push updates using the API', async () => {
  const useActsOfMischief = (catName: string) => {
    const { data } = useSubscription(MISCHIEF_SUBSCRIPTION, {
      variables: { catName },
    })
    return data
  }

  const initialData = {
    actsOfMischief: {
      __typename: 'ActsOfMischief',
      description: 'did not stay away from my bins',
      severity: 'extreme',
    },
  }
  const { wrapper, link } = hookWrapperWithApolloMocks([
    {
      request: {
        query: MISCHIEF_SUBSCRIPTION,
        variables: MATCH_ANY_PARAMETERS,
      },
      result: { data: initialData },
    },
  ])
  const rendered = renderHook(() => useActsOfMischief('la don'), { wrapper })
  expect(link.lastSubscriptionMatches(MISCHIEF_SUBSCRIPTION)).toBeTruthy()
  expect(link.lastSubscription?.variables).toEqual({ catName: 'la don' })

  await actHook(() =>
    waitFor(() => {
      expect(rendered.result.current).toEqual(initialData)
    }),
  )

  const updateData = {
    actsOfMischief: {
      __typename: 'ActsOfMischief',
      description: 'pushed that button',
      severity: 'mild',
    },
  }
  actHook(() => {
    link.sendWildcardSubscriptionResult(MISCHIEF_SUBSCRIPTION, {
      data: updateData,
    })
  })
  await actHook(() =>
    waitFor(() => {
      expect(rendered.result.current).toEqual(updateData)
    }),
  )
})
```
