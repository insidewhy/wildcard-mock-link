import { useQuery, useSubscription } from '@apollo/react-hooks'
import { render, act, waitFor } from '@testing-library/react'
import { renderHook, act as actHook } from '@testing-library/react-hooks'
import gql from 'graphql-tag'
import React, { FC } from 'react'

import {
  MATCH_ANY_PARAMETERS,
  hookWrapperWithApolloMocks,
  withApolloMocks,
} from '.'

/* eslint-disable @typescript-eslint/explicit-function-return-type */

const CAT_QUALITIES_QUERY = gql`
  query($catName: String!) {
    qualities(cats: $catName) {
      loveliness
    }
  }
`

describe('WildcardMockLink', () => {
  describe('handles wildcard queries', () => {
    it('for a single request', async () => {
      const useQueryOnce = (catName: string) => {
        const { data } = useQuery(CAT_QUALITIES_QUERY, {
          variables: { catName },
        })
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
      await actHook(() => link.waitForLastResponse())
      expect(link.lastQueryMatches(CAT_QUALITIES_QUERY)).toBeTruthy()
      expect(link.lastQuery?.variables).toEqual({ catName: 'tortand' })
      expect(result.current).toEqual(data)
    })

    it('for multiple requests with the same mock', async () => {
      const useQueryTwice = () => {
        const { data: firstData } = useQuery(CAT_QUALITIES_QUERY, {
          variables: { catName: 'snorf' },
        })
        const { data: secondData } = useQuery(CAT_QUALITIES_QUERY, {
          variables: { catName: 'candrle' },
        })
        return { firstData, secondData }
      }

      const data = {
        qualities: {
          __typename: 'Qualities',
          loveliness: 'highest',
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
      const rendered = renderHook(useQueryTwice, { wrapper })
      await actHook(() => link.waitForLastResponse())
      expect(link.lastQueryMatches(CAT_QUALITIES_QUERY)).toBeTruthy()
      expect(link.lastQuery?.variables).toEqual({ catName: 'candrle' })
      expect(rendered.result.current).toEqual({
        firstData: data,
        secondData: data,
      })
    })
  })

  describe('can be used to mock subscriptions', () => {
    const MISCHIEF_SUBSCRIPTION = gql`
      subscription($catName: String!) {
        actsOfMischief(cats: $catName) {
          description
          severity
        }
      }
    `

    const useActsOfMischief = (catName: string) => {
      const { data } = useSubscription(MISCHIEF_SUBSCRIPTION, {
        variables: { catName },
      })
      return data
    }

    it('by pushing updates via the API', async () => {
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
      const rendered = renderHook(() => useActsOfMischief('la don'), {
        wrapper,
      })
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

    it('by pushing an update without an "initial response" for wildcard match', async () => {
      const { wrapper, link } = hookWrapperWithApolloMocks([
        {
          request: {
            query: MISCHIEF_SUBSCRIPTION,
            variables: MATCH_ANY_PARAMETERS,
          },
          result: undefined,
        },
      ])
      const rendered = renderHook(() => useActsOfMischief('la don'), {
        wrapper,
      })
      expect(link.lastSubscriptionMatches(MISCHIEF_SUBSCRIPTION)).toBeTruthy()
      expect(link.lastSubscription?.variables).toEqual({ catName: 'la don' })

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
  })
})

describe('withApolloMocks utility', () => {
  const MyCatComponent: FC<{ catName: string }> = ({ catName }) => {
    const { data } = useQuery(CAT_QUALITIES_QUERY, { variables: { catName } })
    if (!data) {
      return <h1 role="main">Loading</h1>
    } else {
      return <h1 role="main">Loveliness: {data.qualities.loveliness}</h1>
    }
  }

  it('can be used to supply mock data to a component tree', async () => {
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
})
