import { useQuery } from '@apollo/react-hooks'
import { render, act } from '@testing-library/react'
import { renderHook, act as actHook } from '@testing-library/react-hooks'
import gql from 'graphql-tag'
import React, { FC } from 'react'

import { MATCH_ANY_PARAMETERS, hookWrapperWithApolloMocks, withApolloMocks } from '.'

/* eslint-disable @typescript-eslint/explicit-function-return-type */

const SIMPLE_QUERY = gql`
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
      await actHook(() => link.waitForLastResponse())
      expect(link.lastQueryMatches(SIMPLE_QUERY)).toBeTruthy()
      expect(link.lastQuery?.variables).toEqual({ catName: 'tortand' })
      expect(rendered.result.current).toEqual(data)
    })

    it('for multiple requests with the same mock', async () => {
      const useQueryTwice = () => {
        const { data: firstData } = useQuery(SIMPLE_QUERY, { variables: { catName: 'snorf' } })
        const { data: secondData } = useQuery(SIMPLE_QUERY, { variables: { catName: 'candrle' } })
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
            query: SIMPLE_QUERY,
            variables: MATCH_ANY_PARAMETERS,
          },
          result: { data },
        },
      ])
      const rendered = renderHook(useQueryTwice, { wrapper })
      await actHook(() => link.waitForLastResponse())
      expect(link.lastQueryMatches(SIMPLE_QUERY)).toBeTruthy()
      expect(link.lastQuery?.variables).toEqual({ catName: 'candrle' })
      expect(rendered.result.current).toEqual({ firstData: data, secondData: data })
    })
  })
})

describe('withApolloMocks utility', () => {
  const MyCatComponent: FC<{ catName: string }> = ({ catName }) => {
    const { data } = useQuery(SIMPLE_QUERY, { variables: { catName } })
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
            query: SIMPLE_QUERY,
            variables: MATCH_ANY_PARAMETERS,
          },
          result: { data },
        },
      ],
    )
    const { getByRole } = render(element)
    await act(() => link.waitForLastResponse())

    expect(link.lastQueryMatches(SIMPLE_QUERY)).toBeTruthy()
    expect(link.lastQuery?.variables).toEqual({ catName: 'mr bad actor face' })
    const mainContent = getByRole('main')
    expect(mainContent?.textContent).toEqual('Loveliness: very')
  })
})
