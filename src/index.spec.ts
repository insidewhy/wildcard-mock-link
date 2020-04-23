import { useQuery } from '@apollo/react-hooks'
import { renderHook, act } from '@testing-library/react-hooks'
import gql from 'graphql-tag'

import { MATCH_ANY_PARAMETERS } from '.'
import { hookWrapperWithApolloMocks } from './utils'

const SIMPLE_QUERY = gql`
  query($catName: String!) {
    qualities(cats: $catName) {
      loveliness
    }
  }
`

describe('WildcardMockLink', () => {
  /* eslint-disable @typescript-eslint/explicit-function-return-type */

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
      await act(() => link.waitForLastResponse())
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
      await act(() => link.waitForLastResponse())
      expect(link.lastQueryMatches(SIMPLE_QUERY)).toBeTruthy()
      expect(link.lastQuery?.variables).toEqual({ catName: 'candrle' })
      expect(rendered.result.current).toEqual({ firstData: data, secondData: data })
    })
  })
})
