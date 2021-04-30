import { useQuery, useSubscription } from '@apollo/client'
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
  describe('can be used for non-subscription queries', () => {
    const useQueryOnce = (catName: string) => {
      const { data } = useQuery(CAT_QUALITIES_QUERY, {
        variables: { catName },
      })
      return data
    }

    describe('handles non-wildcard queries', () => {
      it('for a single request', async () => {
        const variables = { catName: 'Lord Fromtar' }
        const data = {
          qualities: {
            __typename: 'Qualities',
            loveliness: 'very',
          },
        }
        const { wrapper, link } = hookWrapperWithApolloMocks(
          [
            {
              request: {
                query: CAT_QUALITIES_QUERY,
                variables,
              },
              result: { data },
            },
          ],
          undefined,
          { act: actHook },
        )
        const { result } = renderHook(() => useQueryOnce(variables.catName), {
          wrapper,
        })
        await actHook(() => link.waitForLastResponse())
        expect(link.lastQueryMatches(CAT_QUALITIES_QUERY)).toBeTruthy()
        expect(link.lastQuery?.variables).toEqual(variables)
        expect(result.current).toEqual(data)
      })
    })

    describe('handles wildcard queries', () => {
      it('for a single request', async () => {
        const data = {
          qualities: {
            __typename: 'Qualities',
            loveliness: 'very',
          },
        }
        const { wrapper, link } = hookWrapperWithApolloMocks(
          [
            {
              request: {
                query: CAT_QUALITIES_QUERY,
                variables: MATCH_ANY_PARAMETERS,
              },
              result: { data },
            },
          ],
          undefined,
          { act: actHook },
        )
        const { result } = renderHook(() => useQueryOnce('tortand'), {
          wrapper,
        })
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
        const { wrapper, link } = hookWrapperWithApolloMocks(
          [
            {
              request: {
                query: CAT_QUALITIES_QUERY,
                variables: MATCH_ANY_PARAMETERS,
              },
              result: { data },
            },
          ],
          undefined,
          { act: actHook },
        )
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

    it('by pushing updates with sendWildcardSubscriptionResult for wildcard match', async () => {
      const variables = { catName: 'la don' }
      const initialData = {
        actsOfMischief: {
          __typename: 'ActsOfMischief',
          description: 'did not stay away from my bins',
          severity: 'extreme',
        },
      }
      const { wrapper, link } = hookWrapperWithApolloMocks(
        [
          {
            request: {
              query: MISCHIEF_SUBSCRIPTION,
              variables: MATCH_ANY_PARAMETERS,
            },
            result: { data: initialData },
          },
        ],
        undefined,
        { act: actHook },
      )
      const rendered = renderHook(() => useActsOfMischief(variables.catName), {
        wrapper,
      })
      expect(link.lastSubscriptionMatches(MISCHIEF_SUBSCRIPTION)).toBeTruthy()
      expect(link.lastSubscription?.variables).toEqual(variables)

      await waitFor(() => {
        expect(rendered.result.current).toEqual(initialData)
      })

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
      await waitFor(() => {
        expect(rendered.result.current).toEqual(updateData)
      })
    })

    it('by pushing updates with sendSubscriptionResult for non-wildcard match', async () => {
      const variables = { catName: 'Toast Inside' }
      const initialData = {
        actsOfMischief: {
          __typename: 'ActsOfMischief',
          description: 'did not stay away from my bins',
          severity: 'extreme',
        },
      }
      const { wrapper, link } = hookWrapperWithApolloMocks(
        [
          {
            request: {
              query: MISCHIEF_SUBSCRIPTION,
              variables,
            },
            result: { data: initialData },
          },
        ],
        undefined,
        { act: actHook },
      )
      const rendered = renderHook(() => useActsOfMischief(variables.catName), {
        wrapper,
      })
      expect(link.lastSubscriptionMatches(MISCHIEF_SUBSCRIPTION)).toBeTruthy()
      expect(link.lastSubscription?.variables).toEqual(variables)

      await waitFor(() => {
        expect(rendered.result.current).toEqual(initialData)
      })

      const updateData = {
        actsOfMischief: {
          __typename: 'ActsOfMischief',
          description: 'in love',
          severity: 'awesome',
        },
      }
      actHook(() => {
        link.sendSubscriptionResult(MISCHIEF_SUBSCRIPTION, variables, {
          data: updateData,
        })
      })
      await waitFor(() => {
        expect(rendered.result.current).toEqual(updateData)
      })
    })

    it('by pushing an update without an "initial response" for wildcard match', async () => {
      const variables = { catName: 'Mr Box' }
      const { wrapper, link } = hookWrapperWithApolloMocks(
        [
          {
            request: {
              query: MISCHIEF_SUBSCRIPTION,
              variables: MATCH_ANY_PARAMETERS,
            },
            result: undefined,
          },
        ],
        undefined,
        { act: actHook },
      )
      const rendered = renderHook(() => useActsOfMischief(variables.catName), {
        wrapper,
      })
      expect(link.lastSubscriptionMatches(MISCHIEF_SUBSCRIPTION)).toBeTruthy()
      expect(link.lastSubscription?.variables).toEqual(variables)

      const updateData = {
        actsOfMischief: {
          __typename: 'ActsOfMischief',
          description: 'cranky',
          severity: 'mild',
        },
      }
      actHook(() => {
        link.sendWildcardSubscriptionResult(MISCHIEF_SUBSCRIPTION, {
          data: updateData,
        })
      })
      await waitFor(() => {
        expect(rendered.result.current).toEqual(updateData)
      })
    })

    it('by pushing an update without an "initial response" for non-wildcard match', async () => {
      const variables = { catName: 'Tupon The Bravest' }
      const { wrapper, link } = hookWrapperWithApolloMocks(
        [
          {
            request: {
              query: MISCHIEF_SUBSCRIPTION,
              variables,
            },
            result: undefined,
          },
        ],
        undefined,
        { act: actHook },
      )
      const rendered = renderHook(() => useActsOfMischief(variables.catName), {
        wrapper,
      })
      expect(link.lastSubscriptionMatches(MISCHIEF_SUBSCRIPTION)).toBeTruthy()
      expect(link.lastSubscription?.variables).toEqual(variables)

      const updateData = {
        actsOfMischief: {
          __typename: 'ActsOfMischief',
          description: 'OMG the WORLD is on FIRE',
          severity: 'mild',
        },
      }
      actHook(() => {
        link.sendSubscriptionResult(MISCHIEF_SUBSCRIPTION, variables, {
          data: updateData,
        })
      })
      await waitFor(() => {
        expect(rendered.result.current).toEqual(updateData)
      })
    })

    it('by pushing an update without an "initial response" for non-wildcard match without variables', async () => {
      const CUDDLES_SUBSCRIPTION = gql`
        subscription {
          cuddles {
            description
            severity
          }
        }
      `

      const useCuddles = () => {
        const { data } = useSubscription(CUDDLES_SUBSCRIPTION)
        return data
      }

      const { wrapper, link } = hookWrapperWithApolloMocks(
        [
          {
            request: {
              query: CUDDLES_SUBSCRIPTION,
            },
            result: undefined,
          },
        ],
        undefined,
        { act: actHook },
      )
      const rendered = renderHook(() => useCuddles(), {
        wrapper,
      })
      expect(link.lastSubscriptionMatches(CUDDLES_SUBSCRIPTION)).toBeTruthy()

      const updateData = {
        cuddles: {
          __typename: 'Cuddles',
          description: 'Lovingly',
          severity: 'mild',
        },
      }

      actHook(() => {
        link.sendSubscriptionResult(CUDDLES_SUBSCRIPTION, undefined, {
          data: updateData,
        })
      })
      await waitFor(() => {
        expect(rendered.result.current).toEqual(updateData)
      })
    })
  })

  describe('provides waitForAllResponsesRecursively() method', () => {
    it('which returns after all responses have been issued', async () => {
      const catNames = ['Jombar', 'The Rogue', 'Rodmaster']

      const useThreeQueries = () => {
        const { data: firstData } = useQuery(CAT_QUALITIES_QUERY, {
          variables: { catName: catNames[0] },
        })

        const { data: secondData } = useQuery(CAT_QUALITIES_QUERY, {
          variables: { catName: catNames[1] },
          skip: !firstData,
        })

        const { data: thirdData } = useQuery(CAT_QUALITIES_QUERY, {
          variables: { catName: catNames[2] },
          skip: !firstData || !secondData,
        })

        return [firstData, secondData, thirdData]
      }

      const { wrapper, link } = hookWrapperWithApolloMocks(
        catNames.map((catName) => ({
          request: {
            query: CAT_QUALITIES_QUERY,
            variables: { catName },
          },
          result: {
            data: {
              qualities: {
                __typename: 'Qualities',
                loveliness: `${catName} quality`,
              },
            },
          },
        })),
        undefined,
        { act: actHook },
      )

      const { result } = renderHook(useThreeQueries, {
        wrapper,
      })
      await actHook(() => link.waitForAllResponsesRecursively())
      expect(result.current).toEqual(
        catNames.map((catName) => ({
          qualities: {
            loveliness: `${catName} quality`,
            __typename: 'Qualities',
          },
        })),
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
      { act },
    )
    const { getByRole } = render(element)
    await act(() => link.waitForLastResponse())

    expect(link.lastQueryMatches(CAT_QUALITIES_QUERY)).toBeTruthy()
    expect(link.lastQuery?.variables).toEqual({ catName: 'mr bad actor face' })
    const mainContent = getByRole('main')
    expect(mainContent?.textContent).toEqual('Loveliness: very')
  })
})
