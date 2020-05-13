import { MockedResponse } from '@apollo/react-testing'
import {
  Operation,
  FetchResult,
  Observable,
  GraphQLRequest,
  ApolloLink,
} from 'apollo-link'
import { addTypenameToDocument } from 'apollo-utilities'
import delay from 'delay'
import stringify from 'fast-json-stable-stringify'
import {
  print,
  DocumentNode,
  OperationDefinitionNode,
  DefinitionNode,
} from 'graphql'

export {
  withApolloMocks,
  hookWrapperWithApolloMocks,
  HookWrapperAndLink,
  WildcardMockOptions,
  MockLinkAndElement,
} from './utils'

export const MATCH_ANY_PARAMETERS = Symbol()

export type GraphQLVariables = Record<string, any>

export interface GraphQLRequestWithWildcard
  extends Omit<GraphQLRequest, 'variables'> {
  variables?: GraphQLRequest['variables'] | typeof MATCH_ANY_PARAMETERS
}

export interface WildcardMockedResponse
  extends Omit<MockedResponse, 'request'> {
  request: GraphQLRequestWithWildcard
  nMatches?: number
}

type MockedResponseWithoutRequest = Omit<MockedResponse, 'request'>

export type MockedResponses = ReadonlyArray<
  WildcardMockedResponse | MockedResponse
>

interface WildcardMock extends MockedResponseWithoutRequest {
  nMatches: number
}

function isWildcard(
  mock: WildcardMockedResponse | MockedResponse,
): mock is WildcardMockedResponse {
  return mock.request.variables === MATCH_ANY_PARAMETERS
}

const getResultFromFetchResult = (
  result: FetchResult | (() => FetchResult),
): FetchResult => (typeof result === 'function' ? result() : result)

interface StoredOperation {
  query: DocumentNode
  variables: GraphQLVariables
  context: GraphQLVariables
}

const toStoredOperation = (op: Operation): StoredOperation => ({
  query: op.query,
  variables: op.variables,
  context: op.getContext(),
})

type FetchResultObserver = ZenObservable.SubscriptionObserver<FetchResult>

const forwardResponseToObserver = (
  observer: FetchResultObserver,
  response: MockedResponseWithoutRequest,
  complete: boolean,
): void => {
  const { result, error, delay } = response
  if (result) {
    setTimeout(() => {
      observer.next(getResultFromFetchResult(result))
      if (complete) {
        observer.complete()
      }
    }, delay)
  } else if (error) {
    setTimeout(() => {
      observer.error(error)
    }, delay)
  }
}

function isOperationDefinitionNode(
  node: DefinitionNode,
): node is OperationDefinitionNode {
  return (node as OperationDefinitionNode).operation !== undefined
}

/**
 * Extends MockLink to provide the ability to match request queries independent
 * of their variables and have them match 1 or more responses. Also stores the
 * last request for use in assertion frameworks.
 */
export class WildcardMockLink extends ApolloLink {
  private wildcardMatches = new Map<string, WildcardMock[]>()
  private regularMatches = new Map<string, MockedResponse[]>()

  public lastQuery?: StoredOperation
  public lastMutation?: StoredOperation
  public lastSubscription?: StoredOperation

  private pendingResponses = new Set<Promise<void>>()
  private lastResponse?: Promise<void>

  private openSubscriptions = new Map<string, FetchResultObserver>()

  constructor(mockedResponses: MockedResponses, public addTypename = true) {
    super()

    mockedResponses.forEach((mockedResponse) => {
      if (isWildcard(mockedResponse)) {
        this.addWildcardMockedResponse(mockedResponse)
      } else {
        this.addMockedResponse(mockedResponse)
      }
    })
  }

  request(op: Operation): Observable<FetchResult> | null {
    const opDefNode = op.query.definitions.find(isOperationDefinitionNode)
    const operationType = opDefNode?.operation

    if (operationType === 'subscription') {
      return this.requestSubscription(op)
    }

    if (operationType === 'mutation') {
      this.lastMutation = toStoredOperation(op)
    } else {
      this.lastQuery = toStoredOperation(op)
    }

    const wildcardMock = this.getWildcardMockMatch(op)
    if (wildcardMock) {
      if (!wildcardMock.error && !wildcardMock.result) {
        throw new Error('Must provide error or result for query/mutation mocks')
      }

      const response = new Observable<FetchResult>((observer) => {
        forwardResponseToObserver(observer, wildcardMock, true)
      })
      this.setLastResponsePromiseFromObservable(response)
      return response
    } else {
      const regularMock = this.getRegularMockMatch(op)
      if (!regularMock) {
        throw new Error('No mocks matched')
      } else if (!regularMock.error && !regularMock.result) {
        throw new Error('Must provide error or result for query/mutation mocks')
      }

      const response = new Observable<FetchResult>((observer) => {
        forwardResponseToObserver(observer, regularMock, true)
      })

      this.setLastResponsePromiseFromObservable(response)
      return response
    }
  }

  requestSubscription(op: Operation): Observable<FetchResult> | null {
    this.lastSubscription = toStoredOperation(op)

    const wildcardMock = this.getWildcardMockMatch(op)
    if (wildcardMock) {
      return new Observable<FetchResult>((observer) => {
        this.openSubscriptions.set(this.queryToString(op.query), observer)
        forwardResponseToObserver(observer, wildcardMock, false)
      })
    } else {
      const regularMock = this.getRegularMockMatch(op)
      if (!regularMock) {
        throw new Error('No mocks matched')
      }

      return new Observable<FetchResult>((observer) => {
        // if there are multiple subscriptions for the same request with the
        // same variables, the last one will be lost
        this.openSubscriptions.set(
          this.queryAndVariablesToString(op.query, op.variables),
          observer,
        )
        forwardResponseToObserver(observer, regularMock, false)
      })
    }
  }

  /**
   * Send a new response to the open subscription matching `request`. This does not
   * work for subscriptions that matched wildcard requests.
   */
  sendSubscriptionResult(
    request: DocumentNode,
    variables: GraphQLVariables | undefined,
    response: FetchResult,
  ): void {
    const subscription = this.openSubscriptions.get(
      this.queryAndVariablesToString(request, variables),
    )
    if (!subscription) {
      throw new Error(
        'Could not send subscription result for subscription that is not open',
      )
    } else {
      subscription.next(response)
    }
  }

  /**
   * Send a new response to the open subscription matching `request`. This only
   * works for subscriptions that matched wildcard requests.
   */
  sendWildcardSubscriptionResult(
    request: DocumentNode,
    response: FetchResult,
  ): void {
    const subscription = this.openSubscriptions.get(this.queryToString(request))
    if (!subscription) {
      throw new Error(
        'Could not send subscription result for subscription that is not open',
      )
    } else {
      subscription.next(response)
    }
  }

  /**
   * Close the subscription matching `request`.
   */
  closeSubscription(request: DocumentNode): void {
    const cacheKey = this.queryToString(request)
    const subscription = this.openSubscriptions.get(cacheKey)
    if (!subscription) {
      throw new Error(
        'Could not close subscription subscription that is not open',
      )
    } else {
      subscription.complete()
      this.openSubscriptions.delete(cacheKey)
    }
  }

  /**
   * Add one or more mocked responses that match any variables.
   */
  addWildcardMockedResponse(...responses: WildcardMockedResponse[]): void {
    responses.forEach((response) => {
      const mockKey = this.queryToString(response.request.query)
      const storedMocks = this.wildcardMatches.get(mockKey)
      const storedMock = {
        result: response.result,
        nMatches: response.nMatches || Number.POSITIVE_INFINITY,
        delay: response.delay || 0,
      }
      if (storedMocks) {
        storedMocks.push(storedMock)
      } else {
        this.wildcardMatches.set(mockKey, [storedMock])
      }
    })
  }

  addMockedResponse(...responses: MockedResponse[]): void {
    responses.forEach((response) => {
      const mockKey = this.queryAndVariablesToString(
        response.request.query,
        response.request.variables,
      )
      const matchesForKey = this.regularMatches.get(mockKey)
      if (matchesForKey) {
        matchesForKey.push(response)
      } else {
        this.regularMatches.set(mockKey, [response])
      }
    })
  }

  /**
   * Remove the wildcard mocked response for `request`.
   */
  removeWildcardMockedResponse(request: DocumentNode): void {
    this.wildcardMatches.delete(this.queryToString(request))
  }

  /**
   * Return true if the last query request matches the argument.
   */
  lastQueryMatches(request: DocumentNode): boolean {
    return (
      !!this.lastQuery &&
      this.queryToString(request) === this.queryToString(this.lastQuery.query)
    )
  }

  /**
   * Return true if the last query request matches the argument.
   */
  lastMutationMatches(request: DocumentNode): boolean {
    return (
      !!this.lastMutation &&
      this.queryToString(request) ===
        this.queryToString(this.lastMutation.query)
    )
  }

  /**
   * Return true if the last subscription request matches the argument.
   */
  lastSubscriptionMatches(request: DocumentNode): boolean {
    return (
      !!this.lastSubscription &&
      this.queryToString(request) ===
        this.queryToString(this.lastSubscription.query)
    )
  }

  /**
   * Wait for the response of the last query or mutation.
   * It cannot wait for responses from subscriptions because they remain open.
   */
  waitForLastResponse(): Promise<void> {
    return this.lastResponse ?? Promise.resolve()
  }

  /**
   * Wait for the all responses that are currently pending.
   */
  waitForAllResponses(): Promise<void> {
    return (Promise.all(
      Array.from(this.pendingResponses),
    ) as unknown) as Promise<void>
  }

  /**
   * Wait for all responses that are currently pending, and all responses that are triggered
   * as a result of those responses being sent.
   */
  async waitForAllResponsesRecursively(): Promise<void> {
    if (!this.pendingResponses.size) {
      return
    }

    await this.waitForAllResponses()
    // allow code to issue new requests within the next tick
    await delay(0)
    await this.waitForAllResponsesRecursively()
  }

  private queryToString(query: DocumentNode): string {
    return print(this.addTypename ? addTypenameToDocument(query) : query)
  }

  private queryAndVariablesToString(
    query: DocumentNode,
    variables: GraphQLVariables | undefined,
  ): string {
    return this.queryToString(query) + stringify(variables || {})
  }

  /**
   * Get wildcard mock match, if it exists, also removing the mock (or
   * decrementing its match count) as necessary.
   */
  private getWildcardMockMatch(op: Operation): WildcardMock | undefined {
    const mockKey = this.queryToString(op.query)
    const mocks = this.wildcardMatches.get(mockKey)

    if (!mocks) {
      return undefined
    }

    const nextMock = mocks[0]
    if (--nextMock.nMatches === 0) {
      mocks.shift()
      if (!mocks.length) {
        this.wildcardMatches.delete(mockKey)
      }
    }
    return nextMock
  }

  private getRegularMockMatch(op: Operation): MockedResponse | undefined {
    const mockKey = this.queryAndVariablesToString(op.query, op.variables)
    const mocks = this.regularMatches.get(mockKey)
    return mocks?.shift()
  }

  private setLastResponsePromiseFromObservable(
    observable?: Observable<FetchResult> | null,
  ): void {
    if (observable) {
      const responsePromise = new Promise<void>((resolve) => {
        observable.subscribe(() => {
          resolve()
          this.pendingResponses.delete(responsePromise)
        })
      })

      this.lastResponse = responsePromise
      this.pendingResponses.add(responsePromise)
    }
  }
}
