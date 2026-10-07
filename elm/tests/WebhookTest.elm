module WebhookTest exposing (suite)

{-| Discord webhook parity: block/embed flattening, nested text
objects, fail-closed parsing, oversized rejection, C0 scrubbing,
and the service-source word gate. Oracle
`src/lib/integrations/webhookBlockKit.ts` (+ the `/\bWEBHOOK\b/`
service source in `store.ts`).
-}

import Expect
import Test exposing (Test, describe, test)
import Webhook exposing (..)


suite : Test
suite =
    describe "Webhook"
        [ test "flattens blocks and embeds to IRC-safe text" <|
            \_ ->
                let
                    flat =
                        payloadToMessage
                            { username = Just "Deploy Bot"
                            , content = Just "Ship it"
                            , blocks =
                                [ BlockHeader (Just "Release")
                                , BlockDivider
                                , BlockSection (Just "v1.2.3")
                                ]
                            , embeds =
                                [ { title = Just "Notes"
                                  , description = Just "fast path"
                                  , url = Nothing
                                  , fields = [ { name = Just "sha", value = Just "abc" } ]
                                  }
                                ]
                            }
                in
                Expect.all
                    [ \_ -> Expect.equal True (String.contains "Deploy Bot" flat)
                    , \_ -> Expect.equal True (String.contains "## Release" flat)
                    , \_ -> Expect.equal True (String.contains "sha: abc" flat)
                    , \_ ->
                        Expect.equal False
                            (String.any (\c -> Char.toCode c < 0x0A || (Char.toCode c > 0x0A && Char.toCode c < 0x20)) flat)
                    ]
                    ()
        , test "parses Discord-shaped webhook JSON including nested block text objects" <|
            \_ ->
                let
                    raw =
                        "{\"username\":\"CI\",\"content\":\"build ok\",\"blocks\":[{\"type\":\"header\",\"text\":{\"type\":\"plain_text\",\"text\":\"Pipeline\"}},{\"type\":\"section\",\"text\":{\"type\":\"mrkdwn\",\"text\":\"main green\"}},{\"type\":\"divider\"}],\"embeds\":[{\"title\":\"Artifacts\",\"description\":\"ready\",\"fields\":[{\"name\":\"job\",\"value\":\"deploy\"}]}]}"
                in
                case parsePayloadJson raw of
                    Nothing ->
                        Expect.fail "expected a payload"

                    Just payload ->
                        Expect.all
                            [ \_ -> Expect.equal (Just "CI") payload.username
                            , \_ ->
                                Expect.equal (Just (BlockHeader (Just "Pipeline")))
                                    (List.head payload.blocks)
                            , \_ ->
                                Expect.equal True
                                    (String.contains "build ok" (payloadToMessage payload))
                            , \_ ->
                                Expect.equal True
                                    (String.contains "## Pipeline" (payloadToMessage payload))
                            , \_ ->
                                Expect.equal True
                                    (String.contains "job: deploy" (payloadToMessage payload))
                            ]
                            ()
        , test "formatNoticeBody flattens JSON and leaves plain text alone" <|
            \_ ->
                let
                    formatted =
                        formatNoticeBody "{\"content\":\"hello from webhook\",\"embeds\":[{\"title\":\"t\",\"description\":\"d\"}]}"
                in
                Expect.all
                    [ \_ -> Expect.equal True (String.contains "hello from webhook" formatted)
                    , \_ -> Expect.equal True (String.contains "t" formatted)
                    , \_ -> Expect.equal False (String.contains "{" formatted)
                    , \_ ->
                        Expect.equal "just a normal notice"
                            (formatNoticeBody "just a normal notice")
                    , \_ -> Expect.equal "{not json" (formatNoticeBody "{not json")
                    , \_ ->
                        Expect.equal "{\"unrelated\":true}"
                            (formatNoticeBody "{\"unrelated\":true}")
                    , \_ -> Expect.equal "{}" (formatNoticeBody "{}")
                    ]
                    ()
        , test "rejects oversized or non-object JSON without throwing" <|
            \_ ->
                let
                    oversized =
                        "{\"content\":\"" ++ String.repeat 13000 "x" ++ "\"}"

                    arrayish =
                        "[" ++ String.repeat 100 "1," ++ "0]"
                in
                Expect.all
                    [ \_ -> Expect.equal Nothing (parsePayloadJson arrayish)
                    , \_ -> Expect.equal Nothing (parsePayloadJson oversized)
                    , \_ ->
                        Expect.equal True
                            (String.contains "content" (formatNoticeBody oversized))
                    ]
                    ()
        , test "scrubs control characters from flattened JSON notice bodies" <|
            \_ ->
                let
                    flat =
                        formatNoticeBody "{\"content\":\"line\\u0001one\",\"blocks\":[{\"type\":\"section\",\"text\":\"two\\u0007three\"}]}"
                in
                Expect.all
                    [ \_ ->
                        Expect.equal False
                            (String.any (\c -> Char.toCode c < 0x0A || (Char.toCode c > 0x0A && Char.toCode c < 0x20)) flat)
                    , \_ -> Expect.equal True (String.contains "line one" flat)
                    , \_ -> Expect.equal True (String.contains "two three" flat)
                    ]
                    ()
        , test "service word gate matches whole words only" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal True (containsWebhookWord "WEBHOOK: created for #general")
                    , \_ -> Expect.equal True (containsWebhookWord "the Webhook fired")
                    , \_ -> Expect.equal True (containsWebhookWord "(webhook)")
                    , \_ -> Expect.equal False (containsWebhookWord "WEBHOOKS are fine")
                    , \_ -> Expect.equal False (containsWebhookWord "mywebhook")
                    , \_ -> Expect.equal False (containsWebhookWord "just a normal notice")
                    ]
                    ()
        ]
