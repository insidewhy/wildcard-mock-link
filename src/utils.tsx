import { MockedProvider } from '@apollo/react-testing'
import React, { FC, ReactElement } from 'react'

import { WildcardMockLink, MockedResponses } from '.'

export interface MockLinkAndElement {
  link: WildcardMockLink
  element: ReactElement
}

export interface WildcardMockOptions {
  addTypename?: boolean
}

/**
 * Render a test with an apollo provider and the provided mocks.
 */
export const withApolloMocks = (
  testComponentFactory: () => ReactElement,
  apolloMocks: MockedResponses = [],
  options: WildcardMockOptions = { addTypename: true },
): MockLinkAndElement => {
  const link = new WildcardMockLink(apolloMocks)

  const element = (
    <MockedProvider addTypename={options.addTypename} link={link}>
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
  const link = new WildcardMockLink(apolloMocks)
  const wrapper: FC = ({ children }) => (
    <MockedProvider addTypename={options.addTypename} link={link}>
      {Wrap ? <Wrap>{children}</Wrap> : (children as ReactElement)}
    </MockedProvider>
  )
  return { wrapper, link }
}
