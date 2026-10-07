module OutboxTest exposing (suite)

import Expect
import Outbox
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "Outbox"
        [ describe "decideFlushTerminal"
            [ test "clears sticky failure when nothing remains waiting" <|
                \_ ->
                    Expect.equal Outbox.ClearFailed
                        (Outbox.decideFlushTerminal
                            { waiting = 0
                            , pruneFailed = 0
                            , retriesUsed = 5
                            , maxAutoRetries = Nothing
                            , retryDelayMs = Nothing
                            , connected = True
                            }
                        )
            , test "defers on drop even when the retry budget is exhausted" <|
                \_ ->
                    Expect.equal Outbox.Defer
                        (Outbox.decideFlushTerminal
                            { waiting = 2
                            , pruneFailed = 0
                            , retriesUsed = toFloat Outbox.autoRetryLimit
                            , maxAutoRetries = Nothing
                            , retryDelayMs = Nothing
                            , connected = False
                            }
                        )
            , test "defers on drop without burning a retry slot" <|
                \_ ->
                    Expect.equal Outbox.Defer
                        (Outbox.decideFlushTerminal
                            { waiting = 1
                            , pruneFailed = 0
                            , retriesUsed = 0
                            , maxAutoRetries = Nothing
                            , retryDelayMs = Nothing
                            , connected = False
                            }
                        )
            , test "schedules an auto-retry while connected and under budget" <|
                \_ ->
                    Expect.equal
                        (Outbox.ScheduleRetry { nextRetries = 3, delayMs = Outbox.autoRetryDelayMs })
                        (Outbox.decideFlushTerminal
                            { waiting = 1
                            , pruneFailed = 0
                            , retriesUsed = 2
                            , maxAutoRetries = Nothing
                            , retryDelayMs = Nothing
                            , connected = True
                            }
                        )
            , test "marks delivery failed only when connected and exhausted" <|
                \_ ->
                    Expect.equal
                        (Outbox.MarkFailed { deliveryWaiting = 2 })
                        (Outbox.decideFlushTerminal
                            { waiting = 3
                            , pruneFailed = 1
                            , retriesUsed = toFloat Outbox.autoRetryLimit
                            , maxAutoRetries = Nothing
                            , retryDelayMs = Nothing
                            , connected = True
                            }
                        )
            , test "never reports negative deliveryWaiting" <|
                \_ ->
                    Expect.equal
                        (Outbox.MarkFailed { deliveryWaiting = 0 })
                        (Outbox.decideFlushTerminal
                            { waiting = 1
                            , pruneFailed = 4
                            , retriesUsed = toFloat Outbox.autoRetryLimit
                            , maxAutoRetries = Nothing
                            , retryDelayMs = Nothing
                            , connected = True
                            }
                        )
            , test "floors fractional counters and honors custom limits" <|
                \_ ->
                    Expect.equal
                        (Outbox.ScheduleRetry { nextRetries = 1, delayMs = 100 })
                        (Outbox.decideFlushTerminal
                            { waiting = 1.9
                            , pruneFailed = 0.4
                            , retriesUsed = 0.8
                            , maxAutoRetries = Just 1
                            , retryDelayMs = Just 100
                            , connected = True
                            }
                        )
            ]
        , describe "composerChrome"
            [ test "online and empty shows nothing" <|
                \_ ->
                    Expect.equal Nothing
                        (Outbox.composerChrome { connected = True, queuedCount = 0, deliveryFailed = False })
            , test "offline and empty still shows the saved-on-device chip" <|
                \_ ->
                    Expect.equal
                        (Just
                            { kind = Outbox.EmptyOffline
                            , count = 0
                            , label = "Offline · Saved on this device"
                            , announcement = "Offline. Messages you send are saved on this device."
                            , tone = Outbox.ToneOffline
                            , canRetry = False
                            }
                        )
                        (Outbox.composerChrome { connected = False, queuedCount = 0, deliveryFailed = False })
            , test "labels offline queues as will-send-on-reconnect" <|
                \_ ->
                    Expect.equal
                        (Just
                            { kind = Outbox.QueuedOffline
                            , count = 2
                            , label = "Saved (2) · Sends when you reconnect"
                            , announcement = "2 messages saved on this device. Sends when you reconnect."
                            , tone = Outbox.ToneQueued
                            , canRetry = False
                            }
                        )
                        (Outbox.composerChrome { connected = False, queuedCount = 2, deliveryFailed = False })
            , test "uses singular phrasing for one queued message" <|
                \_ ->
                    case Outbox.composerChrome { connected = False, queuedCount = 1, deliveryFailed = False } of
                        Just chrome ->
                            Expect.all
                                [ \_ -> Expect.equal "1 message saved on this device. Sends when you reconnect." chrome.announcement
                                , \_ -> Expect.equal "Saved (1) · Sends when you reconnect" chrome.label
                                ]
                                ()

                        Nothing ->
                            Expect.fail "expected chrome"
            , test "waiting online offers retry with a warning tone" <|
                \_ ->
                    case Outbox.composerChrome { connected = True, queuedCount = 3, deliveryFailed = False } of
                        Just chrome ->
                            Expect.all
                                [ \_ -> Expect.equal Outbox.QueuedOnline chrome.kind
                                , \_ -> Expect.equal 3 chrome.count
                                , \_ -> Expect.equal True chrome.canRetry
                                , \_ -> Expect.equal Outbox.ToneWarning chrome.tone
                                , \_ -> Expect.equal "Awaiting send (3) · Still waiting" chrome.label
                                ]
                                ()

                        Nothing ->
                            Expect.fail "expected chrome"
            , test "failed online surfaces retry with an error tone" <|
                \_ ->
                    case Outbox.composerChrome { connected = True, queuedCount = 1, deliveryFailed = True } of
                        Just chrome ->
                            Expect.all
                                [ \_ -> Expect.equal Outbox.FailedOnline chrome.kind
                                , \_ -> Expect.equal True chrome.canRetry
                                , \_ -> Expect.equal Outbox.ToneError chrome.tone
                                , \_ -> Expect.equal "Retryable (1) · Could not send yet" chrome.label
                                , \_ -> Expect.equal "1 message could not send yet. Retry available after you review." chrome.announcement
                                ]
                                ()

                        Nothing ->
                            Expect.fail "expected chrome"
            , test "clamps negative counts and ignores failed flag when empty online" <|
                \_ ->
                    Expect.equal Nothing
                        (Outbox.composerChrome { connected = True, queuedCount = -4, deliveryFailed = True })
            , test "floors fractional counts" <|
                \_ ->
                    case Outbox.composerChrome { connected = False, queuedCount = 2.9, deliveryFailed = False } of
                        Just chrome ->
                            Expect.all
                                [ \_ -> Expect.equal Outbox.QueuedOffline chrome.kind
                                , \_ -> Expect.equal 2 chrome.count
                                , \_ -> Expect.equal "Saved (2) · Sends when you reconnect" chrome.label
                                ]
                                ()

                        Nothing ->
                            Expect.fail "expected chrome"
            , test "keeps offline labels even when deliveryFailed sticks" <|
                \_ ->
                    Expect.equal
                        (Just
                            { kind = Outbox.QueuedOffline
                            , count = 2
                            , label = "Saved (2) · Sends when you reconnect"
                            , announcement = "2 messages saved on this device. Sends when you reconnect."
                            , tone = Outbox.ToneQueued
                            , canRetry = False
                            }
                        )
                        (Outbox.composerChrome { connected = False, queuedCount = 2, deliveryFailed = True })
            ]
        , describe "homeChrome"
            [ test "returns nothing for an empty queue" <|
                \_ ->
                    Expect.equal Nothing
                        (Outbox.homeChrome { connected = False, queuedCount = 0, prunePendingCount = 0, uncertainCount = 0, deliveryFailed = False })
            , test "describes offline queues without a retry control" <|
                \_ ->
                    case Outbox.homeChrome { connected = False, queuedCount = 1, prunePendingCount = 0, uncertainCount = 0, deliveryFailed = False } of
                        Just chrome ->
                            Expect.all
                                [ \_ -> Expect.equal "Saved on this device" chrome.title
                                , \_ -> Expect.equal False chrome.showRetry
                                , \_ -> Expect.equal Outbox.ToneQueued chrome.tone
                                , \_ -> Expect.equal "1 saved message will send when you reconnect." chrome.detail
                                ]
                                ()

                        Nothing ->
                            Expect.fail "expected chrome"
            , test "offers retry while connected and waiting" <|
                \_ ->
                    case Outbox.homeChrome { connected = True, queuedCount = 2, prunePendingCount = 0, uncertainCount = 0, deliveryFailed = False } of
                        Just chrome ->
                            Expect.all
                                [ \_ -> Expect.equal True chrome.showRetry
                                , \_ -> Expect.equal Outbox.ToneWarning chrome.tone
                                , \_ -> Expect.equal "Awaiting send" chrome.title
                                , \_ -> Expect.equal "2 saved messages still waiting. Try sending now if the room is ready." chrome.detail
                                ]
                                ()

                        Nothing ->
                            Expect.fail "expected chrome"
            , test "marks failed local admission honestly" <|
                \_ ->
                    case Outbox.homeChrome { connected = True, queuedCount = 2, prunePendingCount = 0, uncertainCount = 0, deliveryFailed = True } of
                        Just chrome ->
                            Expect.all
                                [ \_ -> Expect.equal True chrome.showRetry
                                , \_ -> Expect.equal Outbox.ToneError chrome.tone
                                , \_ -> Expect.equal "2 saved messages could not be sent yet. Try again only after reviewing the conversation." chrome.detail
                                ]
                                ()

                        Nothing ->
                            Expect.fail "expected chrome"
            , test "keeps offline detail when deliveryFailed sticks" <|
                \_ ->
                    case Outbox.homeChrome { connected = False, queuedCount = 3, prunePendingCount = 0, uncertainCount = 0, deliveryFailed = True } of
                        Just chrome ->
                            Expect.all
                                [ \_ -> Expect.equal False chrome.showRetry
                                , \_ -> Expect.equal Outbox.ToneQueued chrome.tone
                                , \_ -> Expect.equal "3 saved messages will send when you reconnect." chrome.detail
                                ]
                                ()

                        Nothing ->
                            Expect.fail "expected chrome"
            , test "prune-pending rows ask for review without cancelling delivery" <|
                \_ ->
                    case Outbox.homeChrome { connected = True, queuedCount = 3, prunePendingCount = 2, uncertainCount = 0, deliveryFailed = False } of
                        Just chrome ->
                            Expect.all
                                [ \_ -> Expect.equal "Saved messages need review" chrome.title
                                , \_ -> Expect.equal True chrome.showRetry
                                , \_ -> Expect.equal Outbox.ToneWarning chrome.tone
                                , \_ -> Expect.equal "2 sent messages remain stored on this device. Review is still pending; this does not cancel delivery." chrome.detail
                                ]
                                ()

                        Nothing ->
                            Expect.fail "expected chrome"
            , test "uncertain rows warn without auto-retry" <|
                \_ ->
                    case Outbox.homeChrome { connected = True, queuedCount = 3, prunePendingCount = 0, uncertainCount = 1, deliveryFailed = False } of
                        Just chrome ->
                            Expect.all
                                [ \_ -> Expect.equal "Delivery is uncertain" chrome.title
                                , \_ -> Expect.equal False chrome.showRetry
                                , \_ -> Expect.equal Outbox.ToneError chrome.tone
                                , \_ -> Expect.equal "1 message may have reached the connection. They will not be sent again automatically; review before recovering." chrome.detail
                                ]
                                ()

                        Nothing ->
                            Expect.fail "expected chrome"
            ]
        , describe "entryTiming / entryStatusLabel"
            [ test "flags expired rows past the max age" <|
                \_ ->
                    let
                        queuedAt =
                            1000000

                        now =
                            queuedAt + Outbox.maxAgeMs + 1

                        timing =
                            Outbox.entryTiming queuedAt now
                    in
                    Expect.all
                        [ \_ -> Expect.equal True timing.expired
                        , \_ -> Expect.equal False timing.expiringSoon
                        , \_ -> Expect.equal "expired — will be dropped" (Outbox.entryStatusLabel queuedAt now)
                        ]
                        ()
            , test "flags the last 10 percent of TTL as expiring soon" <|
                \_ ->
                    let
                        queuedAt =
                            1000000

                        now =
                            queuedAt + Outbox.maxAgeMs * 0.95

                        timing =
                            Outbox.entryTiming queuedAt now
                    in
                    Expect.all
                        [ \_ -> Expect.equal False timing.expired
                        , \_ -> Expect.equal True timing.expiringSoon
                        , \_ -> Expect.equal "queued · expires soon" (Outbox.entryStatusLabel queuedAt now)
                        ]
                        ()
            , test "treats the exact 10 percent boundary as expiring soon" <|
                \_ ->
                    let
                        queuedAt =
                            1000000

                        now =
                            queuedAt + Outbox.maxAgeMs * 0.9

                        timing =
                            Outbox.entryTiming queuedAt now
                    in
                    Expect.all
                        [ \_ -> Expect.equal False timing.expired
                        , \_ -> Expect.equal True timing.expiringSoon
                        , \_ -> Expect.equal "queued · expires soon" (Outbox.entryStatusLabel queuedAt now)
                        ]
                        ()
            , test "stays ordinary queued just outside the last 10 percent" <|
                \_ ->
                    let
                        queuedAt =
                            1000000

                        now =
                            queuedAt + Outbox.maxAgeMs * 0.9 - 1

                        timing =
                            Outbox.entryTiming queuedAt now
                    in
                    Expect.all
                        [ \_ -> Expect.equal False timing.expired
                        , \_ -> Expect.equal False timing.expiringSoon
                        , \_ -> Expect.equal "queued" (Outbox.entryStatusLabel queuedAt now)
                        ]
                        ()
            , test "keeps ordinary rows as queued" <|
                \_ ->
                    let
                        queuedAt =
                            1000000

                        now =
                            queuedAt + 60000

                        timing =
                            Outbox.entryTiming queuedAt now
                    in
                    Expect.all
                        [ \_ -> Expect.equal 60000 timing.ageMs
                        , \_ -> Expect.equal False timing.expiringSoon
                        , \_ -> Expect.equal "queued" (Outbox.entryStatusLabel queuedAt now)
                        ]
                        ()
            ]
        ]
