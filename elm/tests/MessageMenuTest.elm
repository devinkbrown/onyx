module MessageMenuTest exposing (suite)

{-| Vectors mirroring `src/shell/message/MessageMenu.test.tsx` pure
suites (`messageMenuCapabilities`, `suggestTopicLabelFromMessage`,
`suggestSearchQueryFromMessage`, `loadedMessageActionText`).
Component suites (translation engine, clipboard bridges, focus
motion, delete confirmation) need the popover UI and stay out of
scope for this pure layer.
-}

import App exposing (..)
import Expect
import Test exposing (Test, describe, test)


liveRow : String -> String -> App.ChatMessage
liveRow from body =
    { id = 1
    , from = from
    , body = body
    , whisper = False
    , audience = Nothing
    , highlight = False
    , outboxId = Nothing
    , pending = False
    , plaintext = Nothing
    , at = 1
    , msgid = Nothing
    , reactions = []
    , edited = False
    , deleted = False
    , redacted = False
    , topic = ""
    , msgType = "msg"
    , replyTo = Nothing
    }


inputFor : App.ChatMessage -> CapabilityInput
inputFor msg =
    { msg = msg
    , selfNick = "alice"
    , editingEnabled = True
    , deleteSupported = True
    , channelTarget = True
    }


suite : Test
suite =
    describe "MessageMenu"
        [ describe "capabilities"
            [ test "allows every action for the user's own live text message" <|
                \_ ->
                    Expect.equal
                        { canReply = True
                        , canReact = True
                        , canCopy = True
                        , canSearchText = True
                        , canCopyMoment = True
                        , canStartTopic = True
                        , canEdit = True
                        , canDelete = True
                        , canIgnore = False
                        , canQuote = True
                        , canCollapse = False
                        }
                        (capabilities (inputFor (liveRow "alice" "hello world")))
            , test "disables edit and delete on someone else's message" <|
                \_ ->
                    let
                        base =
                            inputFor (liveRow "alice" "hello world")

                        caps =
                            capabilities { base | selfNick = "bob" }
                    in
                    Expect.all
                        [ \_ -> Expect.equal True caps.canReply
                        , \_ -> Expect.equal True caps.canReact
                        , \_ -> Expect.equal True caps.canCopy
                        , \_ -> Expect.equal True caps.canSearchText
                        , \_ -> Expect.equal True caps.canCopyMoment
                        , \_ -> Expect.equal True caps.canStartTopic
                        , \_ -> Expect.equal False caps.canEdit
                        , \_ -> Expect.equal False caps.canDelete
                        , \_ -> Expect.equal True caps.canIgnore
                        , \_ -> Expect.equal True caps.canQuote
                        , \_ -> Expect.equal True caps.canCollapse
                        ]
                        ()
            , test "disables every live-message action once a message is deleted" <|
                \_ ->
                    let
                        deleted =
                            liveRow "alice" "[deleted]"

                        caps =
                            capabilities (inputFor { deleted | deleted = True })
                    in
                    Expect.all
                        [ \_ -> Expect.equal False caps.canReply
                        , \_ -> Expect.equal False caps.canReact
                        , \_ -> Expect.equal False caps.canCopy
                        , \_ -> Expect.equal False caps.canSearchText
                        , \_ -> Expect.equal False caps.canCopyMoment
                        , \_ -> Expect.equal False caps.canEdit
                        , \_ -> Expect.equal False caps.canDelete
                        ]
                        ()
            , test "treats a redacted message the same as a deleted one" <|
                \_ ->
                    let
                        redacted =
                            liveRow "alice" "gone"

                        caps =
                            capabilities (inputFor { redacted | redacted = True })
                    in
                    Expect.all
                        [ \_ -> Expect.equal False caps.canReact
                        , \_ -> Expect.equal False caps.canCopyMoment
                        , \_ -> Expect.equal False caps.canStartTopic
                        , \_ -> Expect.equal False caps.canDelete
                        ]
                        ()
            , test "forbids editing non-text messages even when owned" <|
                \_ ->
                    let
                        action =
                            liveRow "alice" "waves"

                        caps =
                            capabilities (inputFor { action | msgType = "action" })
                    in
                    Expect.all
                        [ \_ -> Expect.equal False caps.canEdit
                        , \_ -> Expect.equal True caps.canReply
                        , \_ -> Expect.equal True caps.canDelete
                        ]
                        ()
            , test "forbids editing when the server disables editing" <|
                \_ ->
                    let
                        base =
                            inputFor (liveRow "alice" "hello world")

                        caps =
                            capabilities { base | editingEnabled = False }
                    in
                    Expect.all
                        [ \_ -> Expect.equal False caps.canEdit
                        , \_ -> Expect.equal True caps.canDelete
                        ]
                        ()
            , test "forbids editing encrypted rows even when unlocked and owned" <|
                \_ ->
                    let
                        sealed =
                            liveRow "alice" "ONYXDM1 ciphertext-envelope"

                        caps =
                            capabilities
                                (inputFor { sealed | plaintext = Just "private hello" })
                    in
                    Expect.all
                        [ \_ -> Expect.equal False caps.canEdit
                        , \_ -> Expect.equal True caps.canReply
                        , \_ -> Expect.equal True caps.canCopy
                        , \_ -> Expect.equal True caps.canDelete
                        ]
                        ()
            , test "fails closed on a shape-detected legacy envelope" <|
                \_ ->
                    let
                        caps =
                            capabilities (inputFor (liveRow "alice" "ONYXDM1 legacy-envelope"))
                    in
                    Expect.all
                        [ \_ -> Expect.equal False caps.canEdit
                        , \_ -> Expect.equal False caps.canCopy
                        , \_ -> Expect.equal False caps.canSearchText
                        ]
                        ()
            , test "forbids deleting when the store offers no redaction action" <|
                \_ ->
                    let
                        base =
                            inputFor (liveRow "alice" "hello world")

                        caps =
                            capabilities { base | deleteSupported = False }
                    in
                    Expect.all
                        [ \_ -> Expect.equal False caps.canDelete
                        , \_ -> Expect.equal True caps.canEdit
                        ]
                        ()
            , test "forbids redacting a message that is still queued locally" <|
                \_ ->
                    let
                        queued =
                            liveRow "alice" "waiting to send"

                        caps =
                            capabilities (inputFor { queued | pending = True })
                    in
                    Expect.all
                        [ \_ -> Expect.equal False caps.canDelete
                        , \_ -> Expect.equal True caps.canEdit
                        ]
                        ()
            , test "forbids copy when there is no real text" <|
                \_ ->
                    let
                        caps =
                            capabilities (inputFor (liveRow "alice" "   "))
                    in
                    Expect.all
                        [ \_ -> Expect.equal False caps.canCopy
                        , \_ -> Expect.equal False caps.canSearchText
                        , \_ -> Expect.equal True caps.canCopyMoment
                        , \_ -> Expect.equal True caps.canReply
                        ]
                        ()
            , test "does not offer topic starts for direct messages" <|
                \_ ->
                    let
                        base =
                            inputFor (liveRow "alice" "hello world")

                        caps =
                            capabilities { base | channelTarget = False }
                    in
                    Expect.all
                        [ \_ -> Expect.equal False caps.canStartTopic
                        , \_ -> Expect.equal False caps.canCopyMoment
                        , \_ -> Expect.equal True caps.canReply
                        ]
                        ()
            , test "matches nicks case-insensitively when deciding ownership" <|
                \_ ->
                    let
                        caps =
                            capabilities (inputFor (liveRow "Alice" "hi"))
                    in
                    Expect.all
                        [ \_ -> Expect.equal True caps.canEdit
                        , \_ -> Expect.equal True caps.canDelete
                        ]
                        ()
            ]
        , describe "suggestTopicLabel"
            [ test "uses the first meaningful words from a message" <|
                \_ ->
                    Expect.equal
                        (Just "Release blockers for mobile onboarding today")
                        (suggestTopicLabel "Release blockers for mobile onboarding today")
            , test "strips markdown markers, links, and trailing punctuation" <|
                \_ ->
                    Expect.equal
                        (Just "Deploy notes")
                        (suggestTopicLabel "## `Deploy notes`: https://example.test/build")
            , test "shrinks long messages to a valid topic label" <|
                \_ ->
                    Expect.equal
                        (Just "This is a very long incident")
                        (suggestTopicLabel "This is a very long incident investigation with many extra words")
            , test "returns Nothing when no usable label remains" <|
                \_ ->
                    Expect.equal Nothing (suggestTopicLabel "https://example.test")
            ]
        , describe "suggestSearchQuery"
            [ test "uses a compact readable phrase from message text" <|
                \_ ->
                    Expect.equal
                        (Just "Release blockers for mobile onboarding today are waiting")
                        (suggestSearchQuery "Release blockers for mobile onboarding today are waiting")
            , test "strips markdown markers and links before searching" <|
                \_ ->
                    Expect.equal
                        (Just "Deploy notes")
                        (suggestSearchQuery "## `Deploy notes`: https://example.test/build")
            , test "returns Nothing when no searchable words remain" <|
                \_ ->
                    Expect.equal Nothing (suggestSearchQuery "https://example.test")
            ]
        , describe "loadedActionText"
            [ test "uses transient plaintext for a loaded E2EE row" <|
                \_ ->
                    let
                        sealed =
                            liveRow "alice" "ONYXDM1 ciphertext-envelope"
                    in
                    Expect.equal
                        (Just "private hello")
                        (loadedActionText { sealed | plaintext = Just "private hello" })
            , test "never returns ciphertext for a locked E2EE row" <|
                \_ ->
                    Expect.equal
                        Nothing
                        (loadedActionText (liveRow "alice" "ONYXDM1 ciphertext-envelope"))
            , test "rejects deleted, redacted, and empty rows" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal Nothing
                                (loadedActionText
                                    (let
                                        gone =
                                            liveRow "alice" "gone"
                                     in
                                     { gone | deleted = True }
                                    )
                                )
                        , \_ ->
                            Expect.equal Nothing
                                (loadedActionText
                                    (let
                                        gone =
                                            liveRow "alice" "gone"
                                     in
                                     { gone | redacted = True }
                                    )
                                )
                        , \_ -> Expect.equal Nothing (loadedActionText (liveRow "alice" "   "))
                        ]
                        ()
            , test "keeps ordinary visible text unchanged" <|
                \_ ->
                    Expect.equal
                        (Just "ordinary hello")
                        (loadedActionText (liveRow "alice" "ordinary hello"))
            ]
        ]
