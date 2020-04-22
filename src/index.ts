import { MockLink, MockedResponse } from '@apollo/react-testing'
import { Operation, FetchResult, Observable, GraphQLRequest } from 'apollo-link'
import { addTypenameToDocument } from 'apollo-utilities'
import stringify from 'fast-json-stable-stringify'
import { print, DocumentNode, OperationDefinitionNode } from 'graphql'

export const MATCH_ANY_PARAMETERS = Symbol()

export type GraphQLVariables = Record<string, any>

export interface GraphQLRequestWithWildcard extends Omit<GraphQLRequest, 'variables'> {
  variables?: GraphQLRequest['variables'] | symbol
}

export interface WildcardMockedResponse extends Omit<MockedResponse, 'request'> {
  request: GraphQLRequestWithWildcard
  nMatches?: number
}

export type MockedResponses = ReadonlyArray<WildcardMockedResponse | MockedResponse>

interface WildcardMock {
  result: FetchResult | (() => FetchResult) | undefined
  // by default a mock will match an infinite number of requests
  nMatches: number
  delay: number
}

function notWildcard(mock: WildcardMockedResponse | MockedResponse): mock is MockedResponse {
  return mock.request.variables !== MATCH_ANY_PARAMETERS
}

function isWildcard(
  mock: WildcardMockedResponse | MockedResponse,
): mock is WildcardMockedResponse {
  return mock.request.variables === MATCH_ANY_PARAMETERS
}

const getResultFromFetchResult = (result: FetchResult | (() => FetchResult)): FetchResult =>
  typeof result === 'function' ? result() : result

interface StoredOperation {
  query: DocumentNode
  variables: GraphQLVariables
  context: GraphQLVariables
}

const toStoredOperation = (op: Operation) => ({
  query: op.query,
  variables: op.variables,
  context: op.getContext(),
})

/**
 * Extends MockLink to provide the ability to match request queries independent
 * of their variables and have them match 1 or more responses. Also stores the
 * last request for use in assertion frameworks.
 */
export class WildcardMockLink extends MockLink {
  private wildcardMatches = new Map<string, WildcardMock[]>()
  public lastQuery?: StoredOperation
  public lastMutation?: StoredOperation
  public lastSubscription?: StoredOperation

  private lastResponse?: Promise<void>

  private openSubscriptions = new Map<string, ZenObservable.SubscriptionObserver<FetchResult>>()

  constructor(mockedResponses: MockedResponses, addTypename?: boolean) {
    super(mockedResponses.filter(notWildcard), addTypename)
    this.addWildcardMockedResponse(...mockedResponses.filter(isWildcard))
  }

  request(op: Operation): Observable<FetchResult> | null {
    const operationType = (op.query.definitions?.[0] as OperationDefinitionNode)?.operation

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
      const response = new Observable<FetchResult>((observer) => {
        const { result } = wildcardMock
        if (result) {
          setTimeout(() => {
            observer.next(getResultFromFetchResult(result))
            observer.complete()
          }, wildcardMock.delay)
        }
      })
      this.setLastResponsePromiseFromObservable(response)
      return response
    } else {
      const response = super.request(op)
      this.setLastResponsePromiseFromObservable(response)
      return response
    }
  }

  requestSubscription(op: Operation): Observable<FetchResult> | null {
    this.lastSubscription = toStoredOperation(op)

    const wildcardMock = this.getWildcardMockMatch(op)
    if (wildcardMock) {
      return new Observable<FetchResult>((subscriber) => {
        const { result } = wildcardMock
        if (result) {
          setTimeout(() => {
            // if there are multiple wildcard match subscriptions for the same
            // request the last one will be lost
            this.openSubscriptions.set(this.queryToString(op.query), subscriber)
            subscriber.next(getResultFromFetchResult(result))
          }, wildcardMock.delay)
        }
      })
    } else {
      const response = super.request(op)
      if (!response) {
        return null
      }

      return new Observable<FetchResult>((subscriber) => {
        // if there are multiple subscriptions for the same request with the
        // same variables, the last one will be lost
        this.openSubscriptions.set(
          this.queryAndVariablesToString(op.query, op.variables),
          subscriber,
        )
        response.subscribe((value) => {
          subscriber.next(value)
        })
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
      throw new Error('Could not send subscription result for subscription that is not open')
    } else {
      subscription.next(response)
    }
  }

  /**
   * Send a new response to the open subscription matching `request`. This only
   * works for subscriptions that matched wildcard requests.
   */
  sendWildcardSubscriptionResult(request: DocumentNode, response: FetchResult): void {
    const subscription = this.openSubscriptions.get(this.queryToString(request))
    if (!subscription) {
      throw new Error('Could not send subscription result for subscription that is not open')
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
      throw new Error('Could not close subscription subscription that is not open')
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
      !!this.lastQuery && this.queryToString(request) === this.queryToString(this.lastQuery.query)
    )
  }

  /**
   * Return true if the last query request matches the argument.
   */
  lastMutationMatches(request: DocumentNode): boolean {
    return (
      !!this.lastMutation &&
      this.queryToString(request) === this.queryToString(this.lastMutation.query)
    )
  }

  /**
   * Return true if the last subscription request matches the argument.
   */
  lastSubscriptionRequestMatches(request: DocumentNode): boolean {
    return (
      !!this.lastSubscription &&
      this.queryToString(request) === this.queryToString(this.lastSubscription.query)
    )
  }

  /**
   * Wait for the response of the last query or mutation.
   * It cannot wait for responses from subscriptions because they remain open.
   */
  waitForLastResponse(): Promise<void> {
    return this.lastResponse ?? Promise.resolve()
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
    const mockKey = print(op.query)
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

  private setLastResponsePromiseFromObservable(
    observable?: Observable<FetchResult> | null,
  ): void {
    if (observable) {
      this.lastResponse = new Promise((resolve) => {
        observable.subscribe(() => {
          resolve()
        })
      })
    }
  }
}
