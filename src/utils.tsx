import { MockedProvider } from '@apollo/react-testing'
import { ApolloCache } from 'apollo-cache'
import React, { FC, ReactElement } from 'react'

import { WildcardMockLink, WildcardMockLinkOptions, MockedResponses } from '.'

export interface MockLinkAndElement {
  link: WildcardMockLink
  element: ReactElement
}

export interface WildcardMockOptions<TSerializedCache = {}>
  extends WildcardMockLinkOptions {
  cache?: ApolloCache<TSerializedCache>
}

/**
 * Render a test with an apollo provider and the provided mocks.
 */
export function withApolloMocks<TSerializedCache = {}>(
  testComponentFactory: () => ReactElement,
  apolloMocks: MockedResponses = [],
  options: WildcardMockOptions<TSerializedCache> = { addTypename: true },
): MockLinkAndElement {
  const link = new WildcardMockLink(apolloMocks, options)

  const element = (
    <MockedProvider
      addTypename={options.addTypename}
      link={link}
      cache={options.cache}
    >
      {testComponentFactory()}
    </MockedProvider>
  )
  return { element, link }
}

export interface HookWrapperAndLink {
  wrapper: FC
  link: WildcardMockLink
}

/**
 * Make a wrapper (which can be passed to renderHook's `wrapper`) that provided
 * an apollo mocked provider using a WildcardMockLink. Returns the wrapper and
 * the link. See `clockHooks.spec.ts` for a good example of how to use it.
 */
export function hookWrapperWithApolloMocks(
  apolloMocks: MockedResponses,
  Wrap?: FC,
  options: WildcardMockOptions = { addTypename: true },
): HookWrapperAndLink {
  const link = new WildcardMockLink(apolloMocks, options)
  const wrapper: FC = ({ children }) => (
    <MockedProvider addTypename={options.addTypename} link={link}>
      {Wrap ? <Wrap>{children}</Wrap> : (children as ReactElement)}
    </MockedProvider>
  )
  return { wrapper, link }
}
