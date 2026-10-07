module InviteTest exposing (suite)

{-| Invite-link parity vectors, mirroring
`src/lib/invite/inviteCard.test.ts` (plus `inviteLink` round-trip and
the deeplink/nickname edges the card builds on). Query values below
are written the way `URLSearchParams.get` returns them (decoded), and
raw wire forms go through `parseQueryParams` first — matching the
oracle's object-init vs query-string split.
-}

import Dict
import Expect
import Invite exposing (..)
import Test exposing (Test, describe, test)


network : String
network =
    "Libera Garden"


origin : String
origin =
    "https://onyx.example/invite"


opts : { network : String, origin : String }
opts =
    { network = network, origin = origin }


{-| Fixed clock after every `?at=` vector (2026-06-30T12:00:00Z), so
bounds are deterministic. -}
nowMs : Float
nowMs =
    1782820800000


cardOf : List ( String, String ) -> InviteCard
cardOf pairs =
    buildInviteCard (Dict.fromList pairs) nowMs opts


suite : Test
suite =
    describe "Invite"
        [ describe "buildInviteCard"
            [ test "full card with a stable canonical URL" <|
                \_ ->
                    let
                        card =
                            cardOf
                                [ ( "as", "  yuki  " )
                                , ( "at", "2026-06-30T12:00:00Z" )
                                , ( "join", "#general" )
                                , ( "topic", "release train" )
                                , ( "reader", "1" )
                                , ( "ignored", "noise" )
                                ]
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just "#general") card.channel
                        , \_ -> Expect.equal (Just 1782820800000) card.at
                        , \_ -> Expect.equal (Just "release train") card.topic
                        , \_ -> Expect.equal True card.readerMode
                        , \_ -> Expect.equal (Just "yuki") card.guestName
                        , \_ -> Expect.equal Nothing card.inviter
                        , \_ -> Expect.equal [] card.faces
                        , \_ -> Expect.equal network card.network
                        , \_ ->
                            Expect.equal
                                (origin ++ "?join=%23general&at=2026-06-30T12%3A00%3A00.000Z&topic=release+train&reader=1&as=yuki")
                                card.url
                        ]
                        ()
            , test "missing join falls back to a network-only card" <|
                \_ ->
                    let
                        card =
                            cardOf []
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing card.channel
                        , \_ -> Expect.equal Nothing card.topic
                        , \_ -> Expect.equal False card.readerMode
                        , \_ -> Expect.equal ("Join " ++ network) (inviteTitle card)
                        , \_ -> Expect.equal origin card.url
                        ]
                        ()
            , test "blank suggested guest name is absent" <|
                \_ ->
                    let
                        card =
                            cardOf [ ( "as", "   " ), ( "join", "#general" ) ]
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing card.guestName
                        , \_ -> Expect.equal (origin ++ "?join=%23general") card.url
                        ]
                        ()
            , test "headline, welcome, and description" <|
                \_ ->
                    let
                        card =
                            cardOf
                                [ ( "at", "2026-06-30T12:00:00Z" )
                                , ( "as", "yuki" )
                                , ( "join", "#general" )
                                , ( "topic", "release" )
                                , ( "reader", "true" )
                                ]
                    in
                    Expect.all
                        [ \_ -> Expect.equal "#general" (inviteHeadline card)
                        , \_ -> Expect.equal "Choose a display name to walk in." (inviteWelcome card)
                        , \_ -> Expect.equal ("Join #general on " ++ network ++ ". release") (inviteDescription card)
                        , \_ ->
                            Expect.equal
                                "Choose a display name, then pick a room once you are in."
                                (inviteWelcome (cardOf []))
                        ]
                        ()
            , test "open graph metadata" <|
                \_ ->
                    Expect.equal
                        [ { property = "og:title", content = "Join #general on " ++ network }
                        , { property = "og:description", content = "Join #general on " ++ network ++ "." }
                        , { property = "og:url", content = origin ++ "?join=%23general" }
                        , { property = "og:type", content = "website" }
                        ]
                        (inviteOgMeta (cardOf [ ( "join", "#general" ) ]))
            , test "encoded channel and epoch-seconds moment canonicalise" <|
                \_ ->
                    let
                        card =
                            buildInviteCard
                                (Dict.fromList [ ( "as", "guestnick" ), ( "join", "%23space" ), ( "at", "1751000000" ) ])
                                nowMs
                                opts
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just "#space") card.channel
                        , \_ -> Expect.equal (Just 1751000000000) card.at
                        , \_ ->
                            Expect.equal
                                (origin ++ "?join=%23space&at=2025-06-27T04%3A53%3A20.000Z&as=guestnick")
                                card.url
                        ]
                        ()
            , test "trims and keeps valid special and boundary-length nicks" <|
                \_ ->
                    let
                        special =
                            cardOf [ ( "join", "#general" ), ( "as", "  [alice  " ) ]

                        boundaryName =
                            String.repeat 64 "a"

                        boundary =
                            cardOf [ ( "join", "#general" ), ( "as", boundaryName ) ]
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just "[alice") special.guestName
                        , \_ -> Expect.equal True (String.contains "as=%5Balice" special.url)
                        , \_ -> Expect.equal (Just boundaryName) boundary.guestName
                        , \_ -> Expect.equal True (String.contains ("as=" ++ boundaryName) boundary.url)
                        ]
                        ()
            , test "drops guest names that are not valid nicks" <|
                \_ ->
                    let
                        bad name =
                            (cardOf [ ( "join", "#general" ), ( "as", name ) ]).guestName
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing (bad "guest nick")
                        , \_ -> Expect.equal Nothing (bad "yu\u{0000}ki")
                        , \_ -> Expect.equal Nothing (bad "yuki\r\nJOIN #evil")
                        , \_ -> Expect.equal Nothing (bad "a,b")
                        , \_ -> Expect.equal Nothing (bad (String.repeat 65 "a"))
                        ]
                        ()
            , test "drops malformed topic and reader params" <|
                \_ ->
                    let
                        card =
                            cardOf [ ( "join", "#general" ), ( "topic", "bad,label" ), ( "reader", "0" ) ]
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing card.topic
                        , \_ -> Expect.equal False card.readerMode
                        , \_ -> Expect.equal (origin ++ "?join=%23general") card.url
                        ]
                        ()
            ]
        , describe "guest display name"
            [ test "accepts valid names and explains invalid ones plainly" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "River") (parseGuestName (Just "  River  "))
                        , \_ -> Expect.equal Nothing (guestNameError "")
                        , \_ ->
                            case guestNameError "guest nick" of
                                Just message ->
                                    Expect.all
                                        [ \_ -> Expect.equal True (String.contains "start with a letter" (String.toLower message))
                                        , \_ -> Expect.equal False (String.contains "irc" (String.toLower message))
                                        , \_ -> Expect.equal False (String.contains "nick" (String.toLower message))
                                        ]
                                        ()

                                Nothing ->
                                    Expect.fail "expected a name error"
                        , \_ ->
                            case guestNameError (String.repeat 65 "a") of
                                Just message ->
                                    Expect.equal True (String.contains "64 characters" message)

                                Nothing ->
                                    Expect.fail "expected a length error"
                        , \_ -> Expect.equal (Just "Name is required.") (nicknameError "" False)
                        ]
                        ()
            ]
        , describe "inviter and faces"
            [ test "keeps a valid inviter and up to three faces" <|
                \_ ->
                    let
                        card =
                            cardOf [ ( "join", "#lounge" ), ( "by", "  river  " ), ( "with", "aria, mae, jun, extra" ) ]
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just "river") card.inviter
                        , \_ -> Expect.equal [ "aria", "mae", "jun" ] card.faces
                        , \_ ->
                            Expect.equal
                                (origin ++ "?join=%23lounge&by=river&with=aria%2Cmae%2Cjun")
                                card.url
                        , \_ ->
                            Expect.equal
                                ("river invited you to #lounge on " ++ network ++ ".")
                                (inviteDescription card)
                        ]
                        ()
            , test "drops a hostile inviter or face instead of reflecting it" <|
                \_ ->
                    let
                        card =
                            cardOf [ ( "join", "#lounge" ), ( "by", "bad nick" ), ( "with", "ok,bad nick,yu\u{0000}ki" ) ]
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing card.inviter
                        , \_ -> Expect.equal [ "ok" ] card.faces
                        , \_ -> Expect.equal (origin ++ "?join=%23lounge&with=ok") card.url
                        ]
                        ()
            , test "face lists dedupe case-insensitively and fill gaps" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal [ "aria", "MAE" ] (mergeInviteFaces [ [ "aria", "ARIA" ], [ "MAE" ] ])
                        , \_ -> Expect.equal [] (parseInviteFaces Nothing)
                        , \_ -> Expect.equal [] (parseInviteFaces (Just ""))
                        ]
                        ()
            ]
        , describe "query parsing"
            [ test "first param wins and plus decodes to space" <|
                \_ ->
                    let
                        params =
                            parseQueryParams "join=%23general&topic=release+train&join=%23other"
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just "#general") (Dict.get "join" params)
                        , \_ -> Expect.equal (Just "release train") (Dict.get "topic" params)
                        ]
                        ()
            , test "encoded plus survives topic parsing" <|
                \_ ->
                    Expect.equal (Just "a+b") (parseTopicParam (Dict.get "topic" (parseQueryParams "topic=a%2Bb")))
            , test "reader flag spellings" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal True (parseReaderParam (Just "1"))
                        , \_ -> Expect.equal True (parseReaderParam (Just "True"))
                        , \_ -> Expect.equal True (parseReaderParam (Just "READER"))
                        , \_ -> Expect.equal False (parseReaderParam (Just "0"))
                        , \_ -> Expect.equal False (parseReaderParam (Just "yes"))
                        , \_ -> Expect.equal False (parseReaderParam Nothing)
                        ]
                        ()
            , test "moment bounds reject past, far-future, and garbage" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (parseAtParam nowMs (Just "2019-06-30T12:00:00Z"))
                        , \_ -> Expect.equal Nothing (parseAtParam nowMs (Just "2035-01-01T00:00:00Z"))
                        , \_ -> Expect.equal Nothing (parseAtParam nowMs (Just "next friday"))
                        , \_ -> Expect.equal Nothing (parseAtParam nowMs (Just "%zz"))
                        , \_ -> Expect.equal Nothing (parseAtParam nowMs Nothing)
                        , \_ -> Expect.equal (Just 1751000000000) (parseAtParam nowMs (Just "1751000000"))
                        , \_ -> Expect.equal (Just 1751000000000) (parseAtParam nowMs (Just "1751000000000"))
                        ]
                        ()
            , test "form encoder matches URLSearchParams output" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "a+b%23c" (formEncode "a b#c")
                        , \_ -> Expect.equal "%5Balice" (formEncode "[alice")
                        , \_ -> Expect.equal "2026-06-30T12%3A00%3A00.000Z" (formEncode "2026-06-30T12:00:00.000Z")
                        , \_ -> Expect.equal True (utf8ByteLength "release train" == 13)
                        , \_ -> Expect.equal Nothing (parseTopicParam (Just (String.repeat 51 "a")))
                        ]
                        ()
            ]
        , describe "buildInviteLink"
            [ test "builds share and app links that parse back to the card" <|
                \_ ->
                    let
                        link =
                            buildInviteLink
                                { channel = " #general "
                                , guestName = Just "yuki"
                                , at = Just 1782820800000
                                , topic = Just "release"
                                , reader = True
                                , inviter = Just "river"
                                , faces = [ "aria", "mae" ]
                                }
                                { network = network, origin = origin, appOrigin = "/app/" }
                                nowMs

                        query =
                            link.appHref
                                |> String.split "?"
                                |> List.drop 1
                                |> String.join "?"

                        reparsed =
                            buildInviteCard (parseQueryParams query) nowMs opts
                    in
                    Expect.all
                        [ \_ -> Expect.equal True link.hasChannel
                        , \_ -> Expect.equal True (String.startsWith "/app/?" link.appHref)
                        , \_ -> Expect.equal link.card.url link.shareUrl
                        , \_ -> Expect.equal link.card.channel reparsed.channel
                        , \_ -> Expect.equal link.card.at reparsed.at
                        , \_ -> Expect.equal link.card.topic reparsed.topic
                        , \_ -> Expect.equal link.card.readerMode reparsed.readerMode
                        , \_ -> Expect.equal link.card.guestName reparsed.guestName
                        , \_ -> Expect.equal link.card.inviter reparsed.inviter
                        , \_ -> Expect.equal link.card.faces reparsed.faces
                        ]
                        ()
            , test "hostile spec degrades to a network-only invite" <|
                \_ ->
                    let
                        link =
                            buildInviteLink
                                { channel = "not a channel"
                                , guestName = Just "bad nick"
                                , at = Just (0 / 0)
                                , topic = Just "bad,label"
                                , reader = False
                                , inviter = Nothing
                                , faces = []
                                }
                                { network = network, origin = origin, appOrigin = "/app/" }
                                nowMs
                    in
                    Expect.all
                        [ \_ -> Expect.equal False link.hasChannel
                        , \_ -> Expect.equal origin link.shareUrl
                        , \_ -> Expect.equal "/app/" link.appHref
                        ]
                        ()
            ]
        , describe "buildMomentLink"
                [ test "builds the canonical app time-travel URL" <|
                    \_ ->
                        Expect.equal
                            (Just "https://onyx.example/app/?join=%23root&at=2026-07-08T18%3A30%3A00.000Z")
                            (buildMomentLink "https://onyx.example/stats?from=old#pulse" "#root" 1783535400000)
                , test "encodes DM-style targets and drops stale query" <|
                    \_ ->
                        Expect.equal
                            (Just "https://onyx.example/app/?join=%26ops&at=2026-07-08T18%3A30%3A00.000Z")
                            (buildMomentLink "https://onyx.example/app/?utm=drop" "&ops" 1783535400000)
                , test "round-trips the channel through parseJoinParam" <|
                    \_ ->
                        case buildMomentLink "https://onyx.example/app/" "#dev-ops.chat" 1783512000000 of
                            Nothing ->
                                Expect.fail "expected a moment link"

                            Just link ->
                                let
                                    query =
                                        link
                                            |> String.split "?"
                                            |> List.drop 1
                                            |> List.head
                                            |> Maybe.withDefault ""

                                    value name =
                                        query
                                            |> String.split "&"
                                            |> List.filterMap
                                                (\part ->
                                                    case String.split "=" part of
                                                        [ k, v ] ->
                                                            if k == name then
                                                                Just v

                                                            else
                                                                Nothing

                                                        _ ->
                                                            Nothing
                                                )
                                            |> List.head
                                in
                                Expect.all
                                    [ \_ -> Expect.equal (Just "#dev-ops.chat") (parseJoinParam (value "join"))
                                    , \_ -> Expect.equal True (String.contains "at=2026-07-08T12%3A00%3A00.000Z" link)
                                    ]
                                    ()
                , test "fails closed on unparseable origins" <|
                    \_ ->
                        Expect.all
                            [ \_ -> Expect.equal Nothing (buildMomentLink "" "#c" 1783512000000)
                            , \_ -> Expect.equal Nothing (buildMomentLink "notaurl" "#c" 1783512000000)
                            , \_ -> Expect.equal Nothing (buildMomentLink "https:///" "#c" 1783512000000)
                            ]
                            ()
                ]
        ]

