import {
  Operation,
  FetchResult,
  Observable,
  GraphQLRequest,
  ApolloLink,
  OperationVariables,
  Context,
} from '@apollo/client'
import { MockedResponse } from '@apollo/client/testing'
import {
  addTypenameToDocument,
  removeClientSetsFromDocument,
} from '@apollo/client/utilities'
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DefaultData = Record<string, any>

export interface GraphQLRequestWithWildcard
  extends Omit<GraphQLRequest, 'variables'> {
  variables?: GraphQLRequest['variables'] | typeof MATCH_ANY_PARAMETERS
}

type MockedResult<TData = DefaultData, TVars = OperationVariables> =
  | FetchResult<TData>
  | ((variables?: TVars) => TData)

interface MockedResponseWithMatchCount<
  TData = DefaultData,
  TVars = OperationVariables,
> extends Omit<MockedResponse<TData>, 'result'> {
  /** Use Number.POSITIVE_INFINITY to allow infinite matches */
  nMatches?: number
  result?: MockedResult<TData, TVars>
}

type WildcardMock<TData = DefaultData, TVars = OperationVariables> = Omit<
  MockedResponseWithMatchCount<TData, TVars>,
  'request'
> & {
  request: GraphQLRequest
}

export interface WildcardMockedResponse<
  TData = DefaultData,
  TVars = OperationVariables,
> extends Omit<WildcardMock<TData, TVars>, 'request' | 'result'> {
  request: GraphQLRequestWithWildcard
  result?: MockedResult<TData, TVars>
}

export type MockedResponses = readonly WildcardMockedResponse[]

interface Act {
  (fun: () => Promise<void>): Promise<undefined>
  (fun: () => void): void
}

export interface WildcardMockLinkOptions {
  addTypename?: boolean
  act?: Act
  suppressMissingMockWarnings?: boolean
}

// MockedResponseWithMatchCount is a narrower type than WildcardMockedResponse so it
// has to be isNotWildcard rather than isWildcard
function isNotWildcard(
  mock: WildcardMockedResponse,
): mock is MockedResponseWithMatchCount {
  return mock.request.variables !== MATCH_ANY_PARAMETERS
}

const getResultFromFetchResult = (
  result: MockedResult,
  variables?: OperationVariables,
): FetchResult => (typeof result === 'function' ? result(variables) : result)

interface StoredOperation {
  query: DocumentNode
  variables: OperationVariables
  context: Context
}

const toStoredOperation = (op: Operation): StoredOperation => ({
  query: op.query,
  variables: op.variables,
  context: op.getContext(),
})

type FetchResultObserver = ZenObservable.SubscriptionObserver<FetchResult>

const forwardResponseToObserver = (
  observer: FetchResultObserver,
  response: WildcardMock,
  complete: boolean,
  act: Act,
): void => {
  const { result, error, delay, request } = response
  if (result) {
    setTimeout(() => {
      act(() => {
        observer.next(getResultFromFetchResult(result, request.variables))
      })
      if (complete) {
        observer.complete()
      }
    }, delay)
  } else if (error) {
    setTimeout(() => {
      act(() => {
        observer.error(error)
      })
    }, delay)
  }
}

function isOperationDefinitionNode(
  node: DefinitionNode,
): node is OperationDefinitionNode {
  return (node as OperationDefinitionNode).operation !== undefined
}

function callFunction(fun: () => void): void
function callFunction(fun: () => Promise<void>): Promise<undefined>
function callFunction(
  fun: (() => void) | (() => Promise<void>),
): void | Promise<void> {
  return fun()
}

const observableWithError = (error: Error): Observable<FetchResult> =>
  new Observable((observer) => {
    observer.error(error)
  })

/**
 * Normalizes a WildcardMockedResponse removing @client directives from query
 */
const normalizeMockedResponse = (
  mockedResponse: WildcardMockedResponse,
): WildcardMockedResponse => {
  const newMockedResponse = { ...mockedResponse }
  const newQuery = removeClientSetsFromDocument(newMockedResponse.request.query)
  if (newQuery) {
    newMockedResponse.request.query = newQuery
  }
  return newMockedResponse
}

/**
 * Extends MockLink to provide the ability to match request queries independent
 * of their variables and have them match 1 or more responses. Also stores the
 * last request for use in assertion frameworks.
 */
export class WildcardMockLink extends ApolloLink {
  private wildcardMatches = new Map<string, WildcardMock[]>()
  private regularMatches = new Map<string, MockedResponseWithMatchCount[]>()

  queries: StoredOperation[] = []
  mutations: StoredOperation[] = []
  subscriptions: StoredOperation[] = []

  get lastQuery(): StoredOperation | undefined {
    return this.queries[this.queries.length - 1]
  }
  get lastMutation(): StoredOperation | undefined {
    return this.mutations[this.mutations.length - 1]
  }
  get lastSubscription(): StoredOperation | undefined {
    return this.subscriptions[this.subscriptions.length - 1]
  }

  private pendingResponses = new Set<Promise<void>>()
  private lastResponse?: Promise<void>
  private act: Act
  public addTypename: boolean
  public suppressMissingMockWarnings = false

  private openSubscriptions = new Map<string, FetchResultObserver>()

  constructor(
    mockedResponses: MockedResponses,
    public options: boolean | WildcardMockLinkOptions = {
      addTypename: true,
      suppressMissingMockWarnings: false,
    },
  ) {
    super()

    if (typeof options === 'boolean') {
      this.act = callFunction
      this.addTypename = options
    } else {
      this.addTypename = options.addTypename ?? true
      this.suppressMissingMockWarnings =
        options.suppressMissingMockWarnings ?? false
      this.act = options.act ?? callFunction
    }

    mockedResponses.forEach((mockedResponse) => {
      const normalizedMockResponse = normalizeMockedResponse(mockedResponse)
      this.addMockedResponse(normalizedMockResponse)
    })
  }

  request(op: Operation): Observable<FetchResult> | null {
    const opDefNode = op.query.definitions.find(isOperationDefinitionNode)
    const operationType = opDefNode?.operation

    if (operationType === 'subscription') {
      return this.requestSubscription(op)
    }

    if (operationType === 'mutation') {
      this.mutations.push(toStoredOperation(op))
    } else {
      this.queries.push(toStoredOperation(op))
    }

    const wildcardMock = this.getWildcardMockMatch(op)
    if (wildcardMock) {
      if (!wildcardMock.error && !wildcardMock.result) {
        return observableWithError(
          new Error('Must provide error or result for query/mutation mocks'),
        )
      }

      const response = new Observable<FetchResult>((observer) => {
        forwardResponseToObserver(observer, wildcardMock, true, this.act)
      })
      this.setLastResponsePromiseFromObservable(response)
      return response
    } else {
      const regularMock = this.getRegularMockMatch(op)
      if (!regularMock) {
        const errorString = `No mocks matched ${op.operationName}: ${print(
          op.query,
        )}, variables: ${JSON.stringify(op.variables)}`
        if (!this.suppressMissingMockWarnings) {
          console.warn(errorString)
        }
        return observableWithError(new Error(errorString))
      } else if (!regularMock.error && !regularMock.result) {
        return observableWithError(
          new Error('Must provide error or result for query/mutation mocks'),
        )
      }

      const response = new Observable<FetchResult>((observer) => {
        forwardResponseToObserver(observer, regularMock, true, this.act)
      })

      this.setLastResponsePromiseFromObservable(response)
      return response
    }
  }

  requestSubscription(op: Operation): Observable<FetchResult> | null {
    this.subscriptions.push(toStoredOperation(op))

    const wildcardMock = this.getWildcardMockMatch(op)
    if (wildcardMock) {
      return new Observable<FetchResult>((observer) => {
        this.openSubscriptions.set(this.queryToString(op.query), observer)
        forwardResponseToObserver(observer, wildcardMock, false, this.act)
      })
    } else {
      const regularMock = this.getRegularMockMatch(op)
      if (!regularMock) {
        const errorString = `No mocks matched ${op.operationName}: ${print(
          op.query,
        )}, variables: ${JSON.stringify(op.variables)}`
        if (!this.suppressMissingMockWarnings) {
          console.warn(errorString)
        }
        return observableWithError(new Error(errorString))
      }

      return new Observable<FetchResult>((observer) => {
        // if there are multiple subscriptions for the same request with the
        // same variables, the last one will be lost
        this.openSubscriptions.set(
          this.queryAndVariablesToString(op.query, op.variables),
          observer,
        )
        forwardResponseToObserver(observer, regularMock, false, this.act)
      })
    }
  }

  /**
   * Send a new response to the open subscription matching `request`. This does not
   * work for subscriptions that matched wildcard requests.
   */
  sendSubscriptionResult(
    request: DocumentNode,
    variables: OperationVariables | undefined,
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
      this.act(() => {
        subscription.next(response)
      })
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
      this.act(() => {
        subscription.next(response)
      })
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

  addMockedResponse(...responses: MockedResponses): void {
    responses.forEach((response) => {
      if (isNotWildcard(response)) {
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
      } else {
        const mockKey = this.queryToString(response.request.query)
        const storedMocks = this.wildcardMatches.get(mockKey)
        const storedMock = {
          result: response.result,
          nMatches: response.nMatches,
          delay: response.delay ?? 0,
          request: {
            ...response.request,
            variables:
              response.request.variables === MATCH_ANY_PARAMETERS
                ? undefined
                : response.request.variables,
          },
        }
        if (storedMocks) {
          storedMocks.push(storedMock)
        } else {
          this.wildcardMatches.set(mockKey, [storedMock])
        }
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
    if (this.lastResponse) {
      return this.act((): Promise<void> => this.lastResponse!)
    } else {
      return Promise.resolve()
    }
  }

  /**
   * Wait for the all responses that are currently pending.
   */
  waitForAllResponses(): Promise<void> {
    return this.act(
      () =>
        Promise.all(
          Array.from(this.pendingResponses),
        ) as unknown as Promise<void>,
    )
  }

  /**
   * Wait for all responses that are currently pending, and all responses that are triggered
   * as a result of those responses being sent.
   * @param requestWindow How long to wait between between requests for a new request to be
   *        made, by default use 0 which allows one tick.
   */
  waitForAllResponsesRecursively(requestWindow = 0): Promise<void> {
    const runWait = async (): Promise<void> => {
      if (!this.pendingResponses.size) {
        return
      }

      await Promise.all(Array.from(this.pendingResponses))
      // allow code to issue new requests within the request window
      await delay(requestWindow)
      await runWait()
    }
    return this.act(runWait)
  }

  private queryToString(query: DocumentNode): string {
    return print(this.addTypename ? addTypenameToDocument(query) : query)
  }

  private queryAndVariablesToString(
    query: DocumentNode,
    variables: OperationVariables | undefined,
  ): string {
    return this.queryToString(query) + stringify(variables ?? {})
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
    if (nextMock.nMatches === undefined || --nextMock.nMatches === 0) {
      mocks.shift()
      if (!mocks.length) {
        this.wildcardMatches.delete(mockKey)
      }
    }
    return {
      ...nextMock,
      request: { ...nextMock.request, variables: op.variables },
    }
  }

  private getRegularMockMatch(
    op: Operation,
  ): MockedResponseWithMatchCount | undefined {
    const mockKey = this.queryAndVariablesToString(op.query, op.variables)
    const mocks = this.regularMatches.get(mockKey)
    if (!mocks) {
      return undefined
    }

    const nextMock = mocks[0]
    if (nextMock.nMatches === undefined || --nextMock.nMatches === 0) {
      mocks.shift()
      if (!mocks.length) {
        this.regularMatches.delete(mockKey)
      }
    }
    return nextMock
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
