module WatchTogetherTest exposing (suite)

{-| v3/gap-watch — vectors for `WatchTogether`: the `ocean.watch` wire
codec (parse / serialize, including the oracle's own values), the 512
byte server budget, the untrusted-link gate, the shared clock and its
drift tolerance, the host / participant rules, the start editor, the
guard against stale controls, and how server answers settle an in-flight
change.

The behavioural oracle is the SolidJS `watchTogether.ts`; the server
facts (operators only, 512 byte values, `818` / `819` / `913` / `461`)
come from Onyx Server `handleProp`.
-}

import Dict
import Expect
import Set
import Test exposing (Test, describe, test)
import WatchTogether as WT
import Wire


now : Float
now =
    1700000000000


{-| A context where `alice` is an operator in `#room`, everyone listed
is present, and the room holds `raw`. -}
ctxWith : Maybe String -> Maybe String -> WT.Ctx
ctxWith self raw =
    { nowMs = now
    , self = self
    , activeChannel = Just "#room"
    , enabled = True
    , online = True
    , rawFor = \_ -> raw
    , canWrite = \_ -> True
    , present = \_ _ -> True
    , isOperator = \_ _ -> True
    }


idle : WT.Ctx
idle =
    ctxWith (Just "alice") Nothing


{-| The oracle's own value (`watchTogether.test.ts`), `;` separated. -}
oracleValue : String
oracleValue =
    "title=Demo%20Night;url=https%3A%2F%2Fexample.test%2Fv;host=alice;state=paused;position=90;duration=300;participants=alice,bob;handoff=bob"


demo : WT.Activity
demo =
    WT.start
        { host = "alice"
        , title = "Demo Night"
        , url = Just "https://example.test/v"
        , duration = Just 300
        }


demoWire : String
demoWire =
    "title=Demo+Night&url=https%3A%2F%2Fexample.test%2Fv&host=alice&state=paused&position=0&duration=300&participants=alice"


{-| The clock for a value first seen at `at` milliseconds. -}
clockOf : Float -> WT.Activity -> WT.Clock
clockOf at a =
    { nowMs = at, anchor = WT.anchorFor at Nothing (WT.serialize a) a }


withParticipants : List String -> WT.Activity -> WT.Activity
withParticipants names a =
    { a | participants = names }


chain : List (WT.Activity -> Maybe WT.Activity) -> WT.Activity -> Maybe WT.Activity
chain steps a =
    List.foldl (\f acc -> Maybe.andThen f acc) (Just a) steps


reparse : WT.Activity -> Maybe WT.Activity
reparse =
    WT.parse << WT.serialize


line : String -> Wire.IrcMessage
line =
    Wire.parseIrcMessage


{-| Fold server lines into the model like `settleStepWatch` does. -}
settle : WT.Ctx -> List String -> WT.Model -> ( WT.Model, List WT.Effect )
settle ctx lines model =
    List.foldl (\l acc -> WT.settleLine ctx (line l) acc) ( model, [] ) lines


run : WT.Ctx -> List WT.Msg -> WT.Model -> ( WT.Model, List WT.Effect )
run ctx msgs model =
    List.foldl
        (\msg ( m, fx ) ->
            let
                ( next, more ) =
                    WT.update ctx msg m
            in
            ( next, fx ++ more )
        )
        ( model, [] )
        msgs


{-| Adjust a context (record update needs a plain variable). -}
as_ : (WT.Ctx -> WT.Ctx) -> WT.Ctx -> WT.Ctx
as_ f c =
    f c


rev : String -> String -> WT.Rev
rev raw self =
    { channel = "#room", raw = raw, self = self }


isPublish : WT.Effect -> Bool
isPublish e =
    case e of
        WT.Publish _ _ ->
            True

        _ ->
            False


publishes : List WT.Effect -> List String
publishes =
    List.filterMap
        (\e ->
            case e of
                WT.Publish _ v ->
                    Just v

                _ ->
                    Nothing
        )


suite : Test
suite =
    describe "v3/gap-watch WatchTogether"
        [ codec
        , bounds
        , budget
        , links
        , clocks
        , roles
        , durations
        , editor
        , guards
        , settling
        , roomState
        ]



-- ── wire codec ─────────────────────────────────────────────────────────


codec : Test
codec =
    describe "wire codec"
        [ test "the oracle's own value parses (a stale handoff target is dropped, not kept)" <|
            \_ ->
                WT.parse oracleValue
                    |> Expect.equal
                        (Just
                            { title = "Demo Night"
                            , url = Just "https://example.test/v"
                            , host = Just "alice"
                            , state = WT.Paused
                            , position = Just 90
                            , duration = Just 300
                            , at = Nothing
                            , participants = [ "alice", "bob" ]
                            , handoffTo = Nothing
                            }
                        )
        , test "a handoff value keeps its target when both are on the roster" <|
            \_ ->
                WT.parse "title=Clip&host=alice&state=handoff&position=10&participants=alice%2Cbob&handoff=bob"
                    |> Maybe.map (\a -> ( a.state, a.handoffTo, a.position ))
                    |> Expect.equal (Just ( WT.Handoff, Just "bob", Just 10 ))
        , test "a handoff to someone off the roster falls back to paused" <|
            \_ ->
                WT.parse "title=Clip&host=alice&state=handoff&participants=alice&handoff=bob"
                    |> Maybe.map (\a -> ( a.state, a.handoffTo ))
                    |> Expect.equal (Just ( WT.Paused, Nothing ))
        , test "a handoff to the host themself falls back to paused" <|
            \_ ->
                WT.parse "title=Clip&host=alice&state=handoff&participants=alice&handoff=alice"
                    |> Maybe.map (\a -> ( a.state, a.handoffTo ))
                    |> Expect.equal (Just ( WT.Paused, Nothing ))
        , test "a new activity serializes byte for byte like URLSearchParams" <|
            \_ ->
                Expect.equal demoWire (WT.serialize demo)
        , test "a space is + and a comma in the roster is %2C" <|
            \_ ->
                WT.serialize { demo | participants = [ "alice", "bob" ] }
                    |> String.contains "participants=alice%2Cbob"
                    |> Expect.equal True
        , test "playing carries its at anchor after the duration, paused does not" <|
            \_ ->
                let
                    playing =
                        WT.play (clockOf now demo) "alice" demo
                in
                Expect.all
                    [ \p ->
                        Maybe.map WT.serialize p
                            |> Expect.equal
                                (Just "title=Demo+Night&url=https%3A%2F%2Fexample.test%2Fv&host=alice&state=playing&position=0&duration=300&at=1700000000000&participants=alice")
                    , \p ->
                        p
                            |> Maybe.andThen (WT.pause (clockOf now demo) "alice")
                            |> Maybe.map WT.serialize
                            |> Expect.equal (Just demoWire)
                    ]
                    playing
        , test "serialize then parse is a fixed point" <|
            \_ ->
                let
                    a =
                        { demo | participants = [ "alice", "bob", "Carol" ] }
                in
                Expect.equal (Just (WT.normalize a)) (reparse a)
        , test "an empty value, or one with neither title nor link, is no activity" <|
            \_ ->
                Expect.equal [ Nothing, Nothing, Nothing ]
                    [ WT.parse "", WT.parse "   ", WT.parse "state=playing&host=alice" ]
        , test "a link alone is enough, and it names the activity" <|
            \_ ->
                WT.parse "url=https%3A%2F%2Fexample.test%2Fv"
                    |> Maybe.map .title
                    |> Expect.equal (Just "https://example.test/v")
        , test "a title alone is enough" <|
            \_ ->
                WT.parse "title=Quiet+hour"
                    |> Maybe.map (\a -> ( a.title, a.url, a.state ))
                    |> Expect.equal (Just ( "Quiet hour", Nothing, WT.Idle ))
        , test "semicolons separate pairs like ampersands" <|
            \_ ->
                Expect.equal (WT.parse "title=A;state=paused;position=5") (WT.parse "title=A&state=paused&position=5")
        , test "a malformed escape stays as written and never throws" <|
            \_ ->
                WT.parse "title=100%+sure"
                    |> Maybe.map .title
                    |> Expect.equal (Just "100% sure")
        , test "the first value of a repeated key wins" <|
            \_ ->
                WT.parse "title=First&title=Second"
                    |> Maybe.map .title
                    |> Expect.equal (Just "First")
        , test "the property key is the legacy wire key" <|
            \_ ->
                Expect.equal "ocean.watch" WT.propKey
        , test "rawIn finds the key in any case, the way the server folds it" <|
            \_ ->
                Expect.equal
                    [ Just "title=A", Just "title=B", Nothing, Nothing ]
                    [ WT.rawIn (Dict.fromList [ ( "ocean.watch", "title=A" ) ])
                    , WT.rawIn (Dict.fromList [ ( "OCEAN.Watch", "title=B" ) ])
                    , WT.rawIn (Dict.fromList [ ( "ocean.watch", "" ) ])
                    , WT.rawIn (Dict.fromList [ ( "other", "title=C" ) ])
                    ]
        ]



-- ── bounds ─────────────────────────────────────────────────────────────


bounds : Test
bounds =
    describe "bounds"
        [ test "a value over 4096 is rejected, never truncated into another activity" <|
            \_ ->
                Expect.equal Nothing (WT.parse ("title=" ++ String.repeat WT.maxParseLength "x"))
        , test "a long title is cut to 160 characters" <|
            \_ ->
                WT.parse ("title=" ++ String.repeat 400 "t")
                    |> Maybe.map (String.length << .title)
                    |> Expect.equal (Just WT.maxTitleLength)
        , test "controls in a title become spaces" <|
            \_ ->
                WT.parse "title=a%0Ab%07c"
                    |> Maybe.map .title
                    |> Expect.equal (Just "a b c")
        , test "an over-long host is dropped, never truncated into another nick" <|
            \_ ->
                WT.parse ("title=T&host=" ++ String.repeat 65 "h")
                    |> Maybe.map .host
                    |> Expect.equal (Just Nothing)
        , test "a host with whitespace is dropped" <|
            \_ ->
                WT.parse "title=T&host=a%20b"
                    |> Maybe.map .host
                    |> Expect.equal (Just Nothing)
        , test "nick rules: spaces, controls, commas and length" <|
            \_ ->
                Expect.equal
                    [ Just "alice", Nothing, Nothing, Nothing, Nothing, Just (String.repeat 64 "n"), Nothing ]
                    [ WT.normalizeNick " alice "
                    , WT.normalizeNick "a b"
                    , WT.normalizeNick "a,b"
                    , WT.normalizeNick "a\u{0001}b"
                    , WT.normalizeNick ""
                    , WT.normalizeNick (String.repeat 64 "n")
                    , WT.normalizeNick (String.repeat 65 "n")
                    ]
        , test "the roster dedupes without regard to case and keeps first spelling" <|
            \_ ->
                WT.parse "title=T&participants=Bob,bob,BOB,carol"
                    |> Maybe.map .participants
                    |> Expect.equal (Just [ "Bob", "carol" ])
        , test "the roster is capped at 128" <|
            \_ ->
                let
                    names =
                        List.range 1 200 |> List.map (\i -> "p" ++ String.fromInt i)
                in
                WT.normalize (withParticipants names demo)
                    |> .participants
                    |> List.length
                    |> Expect.atMost WT.maxParticipants
        , test "past the cap the host replaces the last ordinary entry" <|
            \_ ->
                let
                    names =
                        List.range 1 130 |> List.map (\i -> "p" ++ String.fromInt i)

                    value =
                        { demo | host = Just "p129", participants = names, url = Nothing, title = "T" }
                            |> WT.encode
                            |> WT.parse
                in
                value
                    |> Maybe.map (\a -> ( List.length a.participants <= WT.maxParticipants, List.member "p129" a.participants ))
                    |> Expect.equal (Just ( True, True ))
        , test "position never passes the duration" <|
            \_ ->
                WT.parse "title=T&duration=100&position=900"
                    |> Maybe.map .position
                    |> Expect.equal (Just (Just 100))
        , test "seconds beyond 366 days, and negative ones, are discarded" <|
            \_ ->
                WT.parse ("title=T&position=" ++ String.fromInt (WT.maxSeconds + 1) ++ "&duration=-4")
                    |> Maybe.map (\a -> ( a.position, a.duration ))
                    |> Expect.equal (Just ( Nothing, Nothing ))
        , test "at must be a plain unix millisecond count" <|
            \_ ->
                Expect.equal
                    [ Just 1700000000000, Nothing, Nothing, Nothing ]
                    (List.map
                        (\at -> WT.parse ("title=T&state=playing&position=1&at=" ++ at) |> Maybe.andThen .at)
                        [ "1700000000000", "0", "9999999999999", "17e11" ]
                    )
        , test "at is ignored unless the activity is playing" <|
            \_ ->
                WT.parse "title=T&state=paused&position=1&at=1700000000000"
                    |> Maybe.map .at
                    |> Expect.equal (Just Nothing)
        , test "an unknown state reads as idle" <|
            \_ ->
                WT.parse "title=T&state=rewinding"
                    |> Maybe.map .state
                    |> Expect.equal (Just WT.Idle)
        ]



-- ── the 512 byte server budget ─────────────────────────────────────────


budget : Test
budget =
    describe "512 byte server budget"
        [ test "the budget is Onyx Server's MAX_PROP_VALUE, not the oracle's 4096" <|
            \_ ->
                Expect.equal 512 WT.wireBudget
        , test "a full roster is trimmed to fit, keeping the host" <|
            \_ ->
                let
                    names =
                        "alice" :: (List.range 1 100 |> List.map (\i -> "participant-" ++ String.fromInt i))

                    wire =
                        WT.serialize (withParticipants names demo)
                in
                Expect.all
                    [ \w -> Expect.atMost WT.wireBudget (String.length w)
                    , \w -> Expect.equal True (String.contains "participants=alice" w)
                    , \w -> Expect.equal True (String.contains "host=alice" w)
                    ]
                    wire
        , test "the pending handoff target survives the trim" <|
            \_ ->
                let
                    names =
                        [ "alice", "zed" ] ++ (List.range 1 100 |> List.map (\i -> "participant-" ++ String.fromInt i))

                    wire =
                        WT.serialize { demo | participants = names, state = WT.Handoff, handoffTo = Just "zed" }
                in
                WT.parse wire
                    |> Maybe.map (\a -> ( a.state, a.handoffTo, String.length wire <= WT.wireBudget ))
                    |> Expect.equal (Just ( WT.Handoff, Just "zed", True ))
        , test "when the link cannot fit it is dropped whole, never truncated" <|
            \_ ->
                let
                    link =
                        "https://example.test/" ++ String.repeat 520 "a"

                    wire =
                        WT.serialize { demo | url = Just link }
                in
                Expect.all
                    [ \w -> Expect.atMost WT.wireBudget (String.length w)
                    , \w -> Expect.equal False (String.contains "url=" w)
                    , \w -> Expect.equal (Just "Demo Night") (Maybe.map .title (WT.parse w))
                    ]
                    wire
        , test "a title too long to fit alongside everything else is shortened last" <|
            \_ ->
                let
                    wire =
                        WT.serialize { demo | title = String.repeat 160 "ж", url = Nothing }
                in
                Expect.atMost WT.wireBudget (String.length wire)
        , test "every serialized value stays within the budget" <|
            \_ ->
                [ demo
                , { demo | title = String.repeat 160 "%", participants = List.repeat 128 "q" }
                , { demo | url = Just ("https://e.test/?q=" ++ String.repeat 400 "%25") }
                ]
                    |> List.map (String.length << WT.serialize)
                    |> List.all (\n -> n <= WT.wireBudget)
                    |> Expect.equal True
        ]



-- ── links ──────────────────────────────────────────────────────────────


links : Test
links =
    let
        ok url =
            test ("accepts \"" ++ url ++ "\"") <|
                \_ -> Expect.equal (Ok url) (WT.checkUrl url)

        refuse why url =
            test ("refuses \"" ++ String.left 40 url ++ "\"") <|
                \_ -> Expect.equal (Err why) (WT.checkUrl url)
    in
    describe "untrusted links"
        [ ok "https://example.test/v"
        , ok "http://example.test/watch?v=1&t=2#x"
        , ok "https://example.test:8443/path"
        , ok "https://[2001:db8::1]/clip"
        , ok "HTTPS://Example.Test/Case"
        , refuse WT.UrlScheme "javascript:alert(1)"
        , refuse WT.UrlScheme "data:text/html,<script>1</script>"
        , refuse WT.UrlScheme "ftp://example.test/file"
        , refuse WT.UrlScheme "//example.test/v"
        , refuse WT.UrlScheme "example.test/v"
        , refuse WT.UrlScheme "file:///etc/passwd"
        , refuse WT.UrlEmpty ""
        , refuse WT.UrlEmpty "   "
        , refuse WT.UrlCredentials "https://real.example@evil.example/"
        , refuse WT.UrlCredentials "https://user:pw@example.test/"
        , refuse WT.UrlCharacters "https://exa mple.test/"
        , refuse WT.UrlCharacters "https://example.test\\evil.test/"
        , refuse WT.UrlCharacters "https://example.test/\u{0007}"
        , refuse WT.UrlNonAsciiHost "https://exаmple.test/"
        , refuse WT.UrlBadHost "https://"
        , refuse WT.UrlBadHost "https://exa$mple.test/"
        , refuse WT.UrlBadHost "https://example.test:99999/"
        , refuse WT.UrlBadHost "https://example.test:80:80/"
        , refuse WT.UrlBadHost "https://.example.test/"
        , refuse WT.UrlBadHost "https://exa..mple.test/"
        , test "a link over 2048 characters is refused" <|
            \_ ->
                Expect.equal (Err WT.UrlTooLong) (WT.checkUrl ("https://example.test/" ++ String.repeat 2100 "a"))
        , test "the host shown before Open is lowercased and keeps a custom port" <|
            \_ ->
                Expect.equal
                    [ Just "www.example.test", Just "example.test:8443", Nothing ]
                    [ WT.urlHost "https://WWW.Example.test/a?b"
                    , WT.urlHost "http://example.test:8443/x"
                    , WT.urlHost "javascript:alert(1)"
                    ]
        , test "a hostile link inside a wire value is dropped, the title survives" <|
            \_ ->
                WT.parse "title=Hi&url=javascript%3Aalert(1)"
                    |> Maybe.map (\a -> ( a.title, a.url ))
                    |> Expect.equal (Just ( "Hi", Nothing ))
        ]



-- ── clocks ─────────────────────────────────────────────────────────────


clocks : Test
clocks =
    let
        playing =
            { demo | state = WT.Playing, position = Just 100, at = Just (round now) }

        raw =
            WT.encode playing
    in
    describe "shared clock"
        [ test "a playing value anchors at its at, so a late joiner sees the same clock" <|
            \_ ->
                -- the value was published 30 s ago; we see it now
                let
                    seen =
                        now + 30000

                    anchor =
                        WT.anchorFor seen Nothing raw playing
                in
                Expect.equal (Just 130) (WT.positionAt seen anchor playing)
        , test "without at the anchor is the moment of receipt (the oracle's behaviour)" <|
            \_ ->
                let
                    noAt =
                        { playing | at = Nothing }

                    anchor =
                        WT.anchorFor now Nothing (WT.encode noAt) noAt
                in
                Expect.equal (Just 100) (WT.positionAt now anchor noAt)
        , test "an at far in the future is a skewed clock: anchor at receipt" <|
            \_ ->
                let
                    skewed =
                        { playing | at = Just (round now + 3600000) }

                    anchor =
                        WT.anchorFor now Nothing (WT.encode skewed) skewed
                in
                Expect.equal (Just 100) (WT.positionAt now anchor skewed)
        , test "playing advances a second at a time and stops at the duration" <|
            \_ ->
                let
                    anchor =
                        WT.anchorFor now Nothing raw playing
                in
                Expect.equal
                    [ Just 100, Just 100, Just 101, Just 160, Just 300, Just 300 ]
                    [ WT.positionAt now anchor playing
                    , WT.positionAt (now + 999) anchor playing
                    , WT.positionAt (now + 1000) anchor playing
                    , WT.positionAt (now + 60000) anchor playing
                    , WT.positionAt (now + 200000) anchor playing
                    , WT.positionAt (now + 9999999) anchor playing
                    ]
        , test "paused positions stand still" <|
            \_ ->
                let
                    paused =
                        { demo | state = WT.Paused, position = Just 42 }

                    anchor =
                        WT.anchorFor now Nothing (WT.encode paused) paused
                in
                Expect.equal [ Just 42, Just 42 ] [ WT.positionAt now anchor paused, WT.positionAt (now + 99000) anchor paused ]
        , test "finished is true only for a playing activity at its duration" <|
            \_ ->
                let
                    anchor =
                        WT.anchorFor now Nothing raw playing
                in
                Expect.equal
                    [ False, True, False ]
                    [ WT.finished now anchor playing
                    , WT.finished (now + 250000) anchor playing
                    , WT.finished (now + 250000) anchor { playing | state = WT.Paused }
                    ]
        , test "a republish within the drift tolerance keeps the local anchor" <|
            \_ ->
                let
                    first =
                        WT.anchorFor now Nothing raw playing

                    -- 10 s later someone joins; the republished clock is 1 s off ours
                    later =
                        now + 10000

                    republish =
                        { playing | position = Just 110, at = Just (round later), participants = [ "alice", "bob" ] }

                    kept =
                        WT.anchorFor later (Just first) (WT.encode republish) republish
                in
                Expect.equal ( first.anchorMs, first.position, WT.encode republish )
                    ( kept.anchorMs, kept.position, kept.raw )
        , test "a republish beyond the tolerance (a seek) re-anchors" <|
            \_ ->
                let
                    first =
                        WT.anchorFor now Nothing raw playing

                    later =
                        now + 10000

                    jumped =
                        { playing | position = Just 250, at = Just (round later) }

                    moved =
                        WT.anchorFor later (Just first) (WT.encode jumped) jumped
                in
                Expect.equal (Just 250) (WT.positionAt later moved jumped)
        , test "an unchanged value keeps its anchor" <|
            \_ ->
                let
                    first =
                        WT.anchorFor now Nothing raw playing
                in
                Expect.equal first (WT.anchorFor (now + 5000) (Just first) raw playing)
        , test "the drift tolerance is two seconds" <|
            \_ ->
                Expect.equal 2 WT.driftToleranceSeconds
        , test "clockFor falls back to a fresh anchor for a value it has not recorded" <|
            \_ ->
                let
                    stale =
                        WT.anchorFor now Nothing "title=old" { demo | state = WT.Paused, position = Just 7 }

                    clock =
                        WT.clockFor (now + 4000) (Dict.fromList [ ( "#room", stale ) ]) "#room" raw playing
                in
                Expect.equal (Just 104) (WT.positionAt clock.nowMs clock.anchor playing)
        , test "reconcile records every room's value and forgets rooms that lost theirs" <|
            \_ ->
                let
                    seen =
                        WT.reconcile now [ ( "#Room", raw ), ( "#other", "title=x" ) ] WT.blank

                    gone =
                        WT.reconcile now [ ( "#other", "title=x" ) ] seen
                in
                Expect.equal ( [ "#other", "#room" ], [ "#other" ] )
                    ( Dict.keys seen.anchors, Dict.keys gone.anchors )
        , test "reconcile leaves the model alone when nothing changed" <|
            \_ ->
                let
                    seen =
                        WT.reconcile now [ ( "#room", raw ) ] WT.blank
                in
                Expect.equal seen (WT.reconcile (now + 8000) [ ( "#room", raw ) ] seen)
        , test "formatClock" <|
            \_ ->
                Expect.equal
                    [ "--:--", "0:00", "0:59", "1:05", "59:59", "1:00:00", "2:05:09" ]
                    (List.map WT.formatClock [ Nothing, Just 0, Just 59, Just 65, Just 3599, Just 3600, Just 7509 ])
        , test "state words" <|
            \_ ->
                Expect.equal
                    [ "Playing", "Paused", "Finished", "Handing over to bob", "Ready" ]
                    [ WT.stateLabel False { demo | state = WT.Playing }
                    , WT.stateLabel False demo
                    , WT.stateLabel True { demo | state = WT.Playing }
                    , WT.stateLabel False { demo | state = WT.Handoff, handoffTo = Just "bob" }
                    , WT.stateLabel False { demo | state = WT.Idle }
                    ]
        ]



-- ── host / participant rules ───────────────────────────────────────────


roles : Test
roles =
    let
        two =
            { demo | participants = [ "alice", "bob" ] }

        clock =
            clockOf now two
    in
    describe "host and participant rules"
        [ test "a new activity is paused at zero with the host as its only participant" <|
            \_ ->
                Expect.equal
                    ( ( WT.Paused, Just 0 ), ( [ "alice" ], Just "alice" ) )
                    ( ( demo.state, demo.position ), ( demo.participants, demo.host ) )
        , test "only the host plays, pauses and seeks" <|
            \_ ->
                Expect.equal
                    [ Nothing, Nothing, Nothing ]
                    [ WT.play clock "bob" two
                    , WT.pause clock "bob" { two | state = WT.Playing }
                    , WT.seek clock "bob" 50 two
                    ]
        , test "play starts from the shown position and stamps the anchor" <|
            \_ ->
                let
                    paused =
                        { two | position = Just 90 }
                in
                WT.play (clockOf now paused) "alice" paused
                    |> Maybe.map (\a -> ( a.state, a.position, a.at ))
                    |> Expect.equal (Just ( WT.Playing, Just 90, Just (round now) ))
        , test "play from a finished clock starts again from the top" <|
            \_ ->
                let
                    done =
                        { two | position = Just 300 }
                in
                WT.play (clockOf now done) "alice" done
                    |> Maybe.andThen .position
                    |> Expect.equal (Just 0)
        , test "pause freezes at the position the host sees, not the published one" <|
            \_ ->
                let
                    playing =
                        { two | state = WT.Playing, position = Just 100, at = Just (round now) }

                    seen =
                        clockOf now playing
                in
                WT.pause { seen | nowMs = now + 25000 } "alice" playing
                    |> Maybe.map (\a -> ( a.state, a.position, a.at ))
                    |> Expect.equal (Just ( WT.Paused, Just 125, Nothing ))
        , test "pause and play are no-ops in the state they already are" <|
            \_ ->
                Expect.equal
                    [ Nothing, Nothing ]
                    [ WT.pause clock "alice" two
                    , WT.play clock "alice" { two | state = WT.Playing }
                    ]
        , test "seek clamps to zero and the duration, and keeps paused" <|
            \_ ->
                let
                    from =
                        { two | position = Just 10 }
                in
                Expect.equal
                    [ Just ( WT.Paused, Just 0 ), Just ( WT.Paused, Just 300 ), Just ( WT.Paused, Just 150 ) ]
                    (List.map
                        (\target -> WT.seek (clockOf now from) "alice" target from |> Maybe.map (\a -> ( a.state, a.position )))
                        [ -50, 9000, 150 ]
                    )
        , test "seeking while playing restamps the anchor" <|
            \_ ->
                let
                    playing =
                        { two | state = WT.Playing, position = Just 100, at = Just (round now) }
                in
                WT.seek (clockOf now playing) "alice" 200 playing
                    |> Maybe.map (\a -> ( a.state, a.position, a.at ))
                    |> Expect.equal (Just ( WT.Playing, Just 200, Just (round now) ))
        , test "seeking to where the clock already is changes nothing" <|
            \_ ->
                Expect.equal Nothing (WT.seek clock "alice" 0 two)
        , test "join adds a name once, case-insensitively" <|
            \_ ->
                Expect.equal
                    [ Just [ "alice", "bob", "carol" ], Nothing, Nothing ]
                    [ WT.join clock "carol" two |> Maybe.map .participants
                    , WT.join clock "BOB" two |> Maybe.map .participants
                    , WT.join clock "bad nick" two |> Maybe.map .participants
                    ]
        , test "join refuses at 128 participants" <|
            \_ ->
                let
                    full =
                        { two | participants = "alice" :: (List.range 1 127 |> List.map (\i -> "p" ++ String.fromInt i)) }
                in
                Expect.equal ( Nothing, True ) ( WT.join (clockOf now full) "late" full, WT.joinBlocked (clockOf now full) "late" full )
        , test "join is blocked when the 512 byte budget would drop the new name" <|
            \_ ->
                let
                    crowded =
                        WT.normalize { two | participants = "alice" :: (List.range 1 40 |> List.map (\i -> "participant-" ++ String.fromInt i)) }
                in
                Expect.equal True (WT.joinBlocked (clockOf now crowded) "newcomer-with-a-long-name-xyz" crowded)
        , test "the host cannot leave; anyone else on the roster can" <|
            \_ ->
                Expect.equal
                    [ Nothing, Just [ "alice" ], Nothing ]
                    [ WT.leave clock "alice" two |> Maybe.map .participants
                    , WT.leave clock "bob" two |> Maybe.map .participants
                    , WT.leave clock "zed" two |> Maybe.map .participants
                    ]
        , test "leaving keeps a playing clock where it is" <|
            \_ ->
                let
                    playing =
                        { two | state = WT.Playing, position = Just 100, at = Just (round now) }

                    seen =
                        { nowMs = now + 12000, anchor = WT.anchorFor now Nothing (WT.encode playing) playing }
                in
                WT.leave seen "bob" playing
                    |> Maybe.map (\a -> ( a.position, a.at ))
                    |> Expect.equal (Just ( Just 100, Just (round now) ))
        , test "offering hosting freezes playback at the shown position" <|
            \_ ->
                let
                    playing =
                        { two | state = WT.Playing, position = Just 100, at = Just (round now) }

                    seen =
                        { nowMs = now + 5000, anchor = WT.anchorFor now Nothing (WT.encode playing) playing }
                in
                WT.offer seen "alice" "bob" playing
                    |> Maybe.map (\a -> ( ( a.state, a.handoffTo ), ( a.position, a.at ) ))
                    |> Expect.equal (Just ( ( WT.Handoff, Just "bob" ), ( Just 105, Nothing ) ))
        , test "offers go only to another participant, only from the host, only once" <|
            \_ ->
                let
                    offered =
                        WT.offer clock "alice" "bob" two
                in
                Expect.equal
                    [ Nothing, Nothing, Nothing, Nothing ]
                    [ WT.offer clock "bob" "alice" two
                    , WT.offer clock "alice" "alice" two
                    , WT.offer clock "alice" "zed" two
                    , offered |> Maybe.andThen (WT.offer clock "alice" "bob")
                    ]
        , test "the target accepts: becomes host, paused, offer cleared" <|
            \_ ->
                two
                    |> WT.offer clock "alice" "bob"
                    |> Maybe.andThen (WT.accept clock "bob")
                    |> Maybe.map (\a -> ( a.host, a.state, a.handoffTo ))
                    |> Expect.equal (Just ( Just "bob", WT.Paused, Nothing ))
        , test "only the named target can accept" <|
            \_ ->
                let
                    offered =
                        { two | participants = [ "alice", "bob", "carol" ] }
                            |> WT.offer clock "alice" "bob"
                in
                Expect.equal [ Nothing, Nothing ]
                    [ offered |> Maybe.andThen (WT.accept clock "carol")
                    , WT.accept clock "bob" two
                    ]
        , test "the host cancels an offer and stays host" <|
            \_ ->
                two
                    |> WT.offer clock "alice" "bob"
                    |> Maybe.andThen (WT.cancelHandoff clock "alice")
                    |> Maybe.map (\a -> ( a.host, a.state, a.handoffTo ))
                    |> Expect.equal (Just ( Just "alice", WT.Paused, Nothing ))
        , test "a pending target who leaves cancels the offer" <|
            \_ ->
                two
                    |> WT.offer clock "alice" "bob"
                    |> Maybe.andThen (WT.leave clock "bob")
                    |> Maybe.map (\a -> ( a.state, a.handoffTo, a.participants ))
                    |> Expect.equal (Just ( WT.Paused, Nothing, [ "alice" ] ))
        , test "play and seek wait while an offer is pending" <|
            \_ ->
                let
                    offered =
                        two |> WT.offer clock "alice" "bob" |> Maybe.withDefault two
                in
                Expect.equal
                    [ Nothing, Nothing ]
                    [ WT.play clock "alice" offered
                    , WT.seek clock "alice" 10 offered
                    ]
        , test "handoff targets are participants who can write" <|
            \_ ->
                let
                    three =
                        { two | participants = [ "alice", "bob", "carol" ] }
                in
                Expect.equal
                    [ [ "bob", "carol" ], [ "carol" ], [] ]
                    [ WT.handoffTargets (always True) three
                    , WT.handoffTargets (\n -> n == "carol") three
                    , WT.handoffTargets (always False) three
                    ]
        , test "claiming an orphaned activity keeps the timeline running" <|
            \_ ->
                let
                    playing =
                        { two | host = Just "gone", state = WT.Playing, position = Just 100, at = Just (round now), participants = [ "gone", "bob" ] }
                in
                WT.claim (clockOf now playing) "bob" playing
                    |> Maybe.map (\a -> ( a.host, a.state, a.position ))
                    |> Expect.equal (Just ( Just "bob", WT.Playing, Just 100 ))
        , test "claiming over a pending offer pauses it, and the host cannot claim itself" <|
            \_ ->
                let
                    pending =
                        { two | host = Just "gone", state = WT.Handoff, handoffTo = Just "bob", participants = [ "gone", "bob", "carol" ] }
                in
                Expect.equal
                    [ Just ( WT.Paused, Nothing ), Nothing ]
                    [ WT.claim clock "carol" pending |> Maybe.map (\a -> ( a.state, a.handoffTo ))
                    , WT.claim clock "alice" two |> Maybe.map (\a -> ( a.state, a.handoffTo ))
                    ]
        , test "roster entries carry their role words" <|
            \_ ->
                let
                    offered =
                        two |> WT.offer clock "alice" "bob" |> Maybe.withDefault two
                in
                Expect.equal
                    [ { nick = "alice", labels = [ "Host" ] }
                    , { nick = "bob", labels = [ "Pending host", "You" ] }
                    ]
                    (WT.rosterEntries (Just "bob") offered)
        , test "host and participant checks ignore case" <|
            \_ ->
                Expect.equal ( True, True, False )
                    ( WT.isHost "ALICE" two, WT.isParticipant "Bob" two, WT.isHost "bob" two )
        , test "every transition returns a value the wire can carry" <|
            \_ ->
                chain
                    [ WT.join clock "carol"
                    , WT.offer clock "alice" "carol"
                    , WT.accept clock "carol"
                    , WT.leave clock "bob"
                    ]
                    two
                    |> Maybe.map (\a -> String.length (WT.serialize a) <= WT.wireBudget)
                    |> Expect.equal (Just True)
        ]



-- ── durations ──────────────────────────────────────────────────────────


durations : Test
durations =
    let
        good raw seconds =
            test ("reads \"" ++ raw ++ "\"") <|
                \_ -> Expect.equal (Ok seconds) (WT.parseDuration raw)

        bad raw =
            test ("refuses \"" ++ raw ++ "\"") <|
                \_ ->
                    case WT.parseDuration raw of
                        Err _ ->
                            Expect.pass

                        Ok _ ->
                            Expect.fail "accepted"
    in
    describe "start editor durations"
        [ good "" Nothing
        , good "  " Nothing
        , good "1:45:00" (Just 6300)
        , good "95:00" (Just 5700)
        , good "0:30" (Just 30)
        , good "95" (Just 5700)
        , good "90m" (Just 5400)
        , good "1h 30m" (Just 5400)
        , good "1h30m15s" (Just 5415)
        , good "45s" (Just 45)
        , good "2 hours" (Just 7200)
        , bad "1:75"
        , bad "1:60:00"
        , bad "1:2:3:4"
        , bad "abc"
        , bad "-5"
        , bad "1.5"
        , bad "99999999999"
        , bad "9999999:00:00"
        ]



-- ── start editor ───────────────────────────────────────────────────────


editor : Test
editor =
    let
        filled title url duration =
            [ WT.MenuSelect "#room", WT.EditTitle title, WT.EditUrl url, WT.EditDuration duration, WT.EditorReview ]

        errorField ( m, _ ) =
            Maybe.andThen .error m.editor |> Maybe.map Tuple.first
    in
    describe "start editor"
        [ test "anyone who can write may open it; it opens on the room" <|
            \_ ->
                run idle [ WT.MenuSelect "#room" ] WT.blank
                    |> (\( m, fx ) -> ( Maybe.map .channel m.editor, fx ))
                    |> Expect.equal ( Just "#room", [] )
        , test "someone who cannot write gets a plain reason, not an editor" <|
            \_ ->
                let
                    ctx =
                        { idle | canWrite = \_ -> False }
                in
                run ctx [ WT.MenuSelect "#room" ] WT.blank
                    |> (\( m, fx ) -> ( m.editor == Nothing, fx ))
                    |> Expect.equal ( True, [ WT.Toast WT.Problem "Can't start watch together" "Only room operators can start a watch activity in #room." ] )
        , test "offline or signed out says so" <|
            \_ ->
                Expect.equal
                    [ Err "Watch together needs a live connection.", Err "Sign in before starting a watch activity." ]
                    [ WT.canStart { idle | online = False } "#room"
                    , WT.canStart { idle | self = Nothing } "#room"
                    ]
        , test "an existing activity cannot be replaced from the editor" <|
            \_ ->
                Expect.equal (Err "#room already has a watch activity.")
                    (WT.canStart (ctxWith (Just "alice") (Just "title=x")) "#room")
        , test "turning the preference on rides along when the editor opens" <|
            \_ ->
                run { idle | enabled = False } [ WT.MenuSelect "#room" ] WT.blank
                    |> Tuple.second
                    |> Expect.equal [ WT.SetEnabled True ]
        , test "choosing the entry for a running activity opens its details instead" <|
            \_ ->
                run (ctxWith (Just "alice") (Just (WT.serialize demo))) [ WT.MenuSelect "#room" ] WT.blank
                    |> (\( m, fx ) -> ( m.expanded, m.editor == Nothing, fx ))
                    |> Expect.equal ( True, True, [ WT.Focus "watch-details-toggle" ] )
        , test "review needs a title, and focus moves to it" <|
            \_ ->
                run idle (filled "  " "" "") WT.blank
                    |> (\( m, fx ) -> ( Maybe.andThen .error m.editor, fx ))
                    |> Expect.equal ( Just ( WT.TitleField, "Give the activity a title." ), [ WT.Focus "watch-start-title" ] )
        , test "a title over 160 characters is refused, not cut" <|
            \_ ->
                run idle (filled (String.repeat 161 "t") "" "") WT.blank
                    |> errorField
                    |> Expect.equal (Just WT.TitleField)
        , test "a hostile link is refused at the field, with words" <|
            \_ ->
                run idle (filled "Night" "javascript:alert(1)" "") WT.blank
                    |> (\( m, fx ) -> ( Maybe.andThen .error m.editor, fx ))
                    |> Expect.equal
                        ( Just ( WT.UrlField, "Use a web link that starts with https:// or http://." )
                        , [ WT.Focus "watch-start-url" ]
                        )
        , test "a bad length is refused at its field" <|
            \_ ->
                run idle (filled "Night" "" "soon") WT.blank
                    |> errorField
                    |> Expect.equal (Just WT.DurationField)
        , test "a link and title that cannot fit the room property are refused with a number" <|
            \_ ->
                run idle (filled (String.repeat 160 "t") ("https://example.test/" ++ String.repeat 300 "a") "") WT.blank
                    |> (\( m, _ ) -> Maybe.andThen .error m.editor |> Maybe.map (\( f, t ) -> ( f, String.startsWith "Too long to share in a room." t )))
                    |> Expect.equal (Just ( WT.UrlField, True ))
        , test "editing a field clears only its own error" <|
            \_ ->
                run idle (filled "Night" "nope" "" ++ [ WT.EditTitle "Night 2" ]) WT.blank
                    |> errorField
                    |> Expect.equal (Just WT.UrlField)
        , test "a valid form goes to review, publishing nothing" <|
            \_ ->
                run idle (filled "Night" "https://example.test/v" "1:30:00") WT.blank
                    |> (\( m, fx ) ->
                            ( case Maybe.map .step m.editor of
                                Just (WT.Reviewing a) ->
                                    Just ( ( a.title, a.url ), ( a.duration, a.host ) )

                                _ ->
                                    Nothing
                            , List.any isPublish fx
                            )
                       )
                    |> Expect.equal ( Just ( ( "Night", Just "https://example.test/v" ), ( Just 5400, Just "alice" ) ), False )
        , test "confirming publishes exactly the reviewed value and waits for the server" <|
            \_ ->
                let
                    ( m, fx ) =
                        run idle (filled "Night" "https://example.test/v" "1:30:00" ++ [ WT.EditorConfirm ]) WT.blank
                in
                Expect.all
                    [ \_ ->
                        Expect.equal
                            [ "title=Night&url=https%3A%2F%2Fexample.test%2Fv&host=alice&state=paused&position=0&duration=5400&participants=alice" ]
                            (publishes fx)
                    , \_ -> Expect.equal Nothing m.editor
                    , \_ -> Expect.equal (Just ( "#room", WT.ActStart )) (Maybe.map (\p -> ( p.channel, p.action )) m.pending)
                    ]
                    ()
        , test "back from review keeps what was typed" <|
            \_ ->
                run idle (filled "Night" "" "" ++ [ WT.EditorBack ]) WT.blank
                    |> (\( m, fx ) -> ( Maybe.map .title m.editor, Maybe.map .step m.editor, fx ))
                    |> Expect.equal ( Just "Night", Just WT.Editing, [ WT.Focus "watch-start-confirm", WT.Focus "watch-start-title" ] )
        , test "confirm outside the review step does nothing" <|
            \_ ->
                run idle [ WT.MenuSelect "#room", WT.EditTitle "Night", WT.EditorConfirm ] WT.blank
                    |> (\( m, fx ) -> ( m.pending, fx ))
                    |> Expect.equal ( Nothing, [] )
        , test "someone else starting one while we review means nothing is replaced" <|
            \_ ->
                let
                    ( reviewing, _ ) =
                        run idle (filled "Night" "" "") WT.blank

                    raced =
                        ctxWith (Just "alice") (Just "title=Theirs&host=bob&participants=bob")
                in
                run raced [ WT.EditorConfirm ] reviewing
                    |> (\( m, fx ) -> ( m.editor, m.pending, fx ))
                    |> Expect.equal
                        ( Nothing
                        , Nothing
                        , [ WT.Toast WT.Problem "Watch activity not started" "A watch activity started in #room while you were reviewing, so nothing was replaced." ]
                        )
        , test "switching room before confirming starts nothing" <|
            \_ ->
                let
                    ( reviewing, _ ) =
                        run idle (filled "Night" "" "") WT.blank
                in
                run { idle | activeChannel = Just "#elsewhere" } [ WT.EditorConfirm ] reviewing
                    |> (\( m, fx ) -> ( m.pending, List.any isPublish fx ))
                    |> Expect.equal ( Nothing, False )
        , test "losing the right to write before confirming returns to the form with the reason" <|
            \_ ->
                let
                    ( reviewing, _ ) =
                        run idle (filled "Night" "" "") WT.blank
                in
                run { idle | canWrite = \_ -> False } [ WT.EditorConfirm ] reviewing
                    |> (\( m, _ ) -> ( m.pending, Maybe.map .step m.editor, Maybe.andThen .error m.editor ))
                    |> Expect.equal
                        ( Nothing
                        , Just WT.Editing
                        , Just ( WT.FormField, "Only room operators can start a watch activity in #room." )
                        )
        , test "a changed signed-in name returns to the form" <|
            \_ ->
                let
                    ( reviewing, _ ) =
                        run idle (filled "Night" "" "") WT.blank
                in
                run { idle | self = Just "mallory" } [ WT.EditorConfirm ] reviewing
                    |> (\( m, _ ) -> ( m.pending, Maybe.map .step m.editor ))
                    |> Expect.equal ( Nothing, Just WT.Editing )
        , test "closing discards the draft" <|
            \_ ->
                run idle [ WT.MenuSelect "#room", WT.EditTitle "x", WT.EditorClose ] WT.blank
                    |> (\( m, _ ) -> m.editor)
                    |> Expect.equal Nothing
        ]



-- ── stale controls, mutations, end ─────────────────────────────────────


guards : Test
guards =
    let
        playingValue =
            WT.serialize
                { demo
                    | participants = [ "alice", "bob" ]
                    , state = WT.Playing
                    , position = Just 100
                    , at = Just (round now)
                }

        pausedValue =
            WT.serialize { demo | participants = [ "alice", "bob" ] }

        hostCtx raw =
            ctxWith (Just "alice") (Just raw)
    in
    describe "controls, stale revisions and ending"
        [ test "the host plays: publishes a playing value with an at anchor" <|
            \_ ->
                run (hostCtx pausedValue) [ WT.Play (rev pausedValue "alice") ] WT.blank
                    |> Tuple.second
                    |> publishes
                    |> List.map (String.contains "state=playing&position=0&duration=300&at=1700000000000")
                    |> Expect.equal [ True ]
        , test "a control rendered against an older value fails closed" <|
            \_ ->
                run (hostCtx playingValue) [ WT.Pause (rev pausedValue "alice") ] WT.blank
                    |> (\( m, fx ) -> ( publishes fx, Maybe.map .text m.notice, fx ))
                    |> Expect.equal
                        ( []
                        , Just "Could not pause. The activity changed. Review it and try again."
                        , [ WT.Focus "watch-status" ]
                        )
        , test "a control from another room or identity fails closed" <|
            \_ ->
                Expect.equal
                    [ [], [] ]
                    [ run { idle | activeChannel = Just "#other", rawFor = \_ -> Just pausedValue } [ WT.Play (rev pausedValue "alice") ] WT.blank |> Tuple.second |> publishes
                    , run (as_ (\c -> { c | self = Just "mallory" }) (hostCtx pausedValue)) [ WT.Play (rev pausedValue "alice") ] WT.blank |> Tuple.second |> publishes
                    ]
        , test "no live link means no write" <|
            \_ ->
                run (as_ (\c -> { c | online = False }) (hostCtx pausedValue)) [ WT.Play (rev pausedValue "alice") ] WT.blank
                    |> (\( m, fx ) -> ( publishes fx, Maybe.map .text m.notice ))
                    |> Expect.equal ( [], Just "Could not start playback. Watch together needs a live connection." )
        , test "a participant without operator rights is told, not sent to a 913" <|
            \_ ->
                run (as_ (\c -> { c | canWrite = \_ -> False }) (ctxWith (Just "bob") (Just pausedValue))) [ WT.Join (rev pausedValue "bob") ] WT.blank
                    |> (\( m, fx ) -> ( publishes fx, Maybe.map .text m.notice ))
                    |> Expect.equal ( [], Just "Could not join. Only room operators can change the watch activity in #room." )
        , test "a non-host pressing play gets a clear no, not a publish" <|
            \_ ->
                run (ctxWith (Just "bob") (Just pausedValue)) [ WT.Play (rev pausedValue "bob") ] WT.blank
                    |> (\( m, fx ) -> ( publishes fx, Maybe.map .tone m.notice ))
                    |> Expect.equal ( [], Just WT.Problem )
        , test "while a change is in flight a second press is ignored" <|
            \_ ->
                let
                    ( first, _ ) =
                        run (hostCtx pausedValue) [ WT.Play (rev pausedValue "alice") ] WT.blank
                in
                run (hostCtx pausedValue) [ WT.Play (rev pausedValue "alice") ] first
                    |> Tuple.second
                    |> Expect.equal []
        , test "a stuck change stops blocking after ten seconds" <|
            \_ ->
                let
                    ( first, _ ) =
                        run (hostCtx pausedValue) [ WT.Play (rev pausedValue "alice") ] WT.blank

                    later =
                        as_ (\c -> { c | nowMs = now + WT.pendingTimeoutMs + 1 }) (hostCtx pausedValue)
                in
                run later [ WT.Play (rev pausedValue "alice") ] first
                    |> Tuple.second
                    |> publishes
                    |> List.length
                    |> Expect.equal 1
        , test "seeks while a change is in flight coalesce to the latest" <|
            \_ ->
                let
                    ( first, _ ) =
                        run (hostCtx pausedValue) [ WT.Play (rev pausedValue "alice") ] WT.blank

                    ( queued, fx ) =
                        run (hostCtx pausedValue) [ WT.SeekTo (rev pausedValue "alice") "50", WT.SeekTo (rev pausedValue "alice") "80" ] first
                in
                Expect.equal ( Just ( "#room", 80 ), [] ) ( queued.queuedSeek, fx )
        , test "nudging moves the shown clock by ten seconds" <|
            \_ ->
                run (hostCtx playingValue) [ WT.Nudge (rev playingValue "alice") 10 ] WT.blank
                    |> Tuple.second
                    |> publishes
                    |> List.map (String.contains "position=110")
                    |> Expect.equal [ True ]
        , test "ending asks first, stages the exact revision, and sends nothing" <|
            \_ ->
                let
                    r =
                        rev pausedValue "alice"
                in
                run (hostCtx pausedValue) [ WT.AskEnd r ] WT.blank
                    |> (\( m, fx ) -> ( m.endConfirm, fx ))
                    |> Expect.equal ( Just r, [ WT.Focus "watch-end-confirm" ] )
        , test "confirming the end removes the property and waits for 819" <|
            \_ ->
                let
                    r =
                        rev pausedValue "alice"
                in
                run (hostCtx pausedValue) [ WT.AskEnd r, WT.ConfirmEnd r ] WT.blank
                    |> (\( m, fx ) -> ( Maybe.map .action m.pending, m.endConfirm, List.member (WT.Remove "#room") fx ))
                    |> Expect.equal ( Just WT.ActEnd, Nothing, True )
        , test "cancelling the end puts focus back on its trigger" <|
            \_ ->
                let
                    r =
                        rev pausedValue "alice"
                in
                run (hostCtx pausedValue) [ WT.AskEnd r, WT.CancelEnd ] WT.blank
                    |> (\( m, fx ) -> ( m.endConfirm, List.drop 1 fx ))
                    |> Expect.equal ( Nothing, [ WT.Focus "watch-end" ] )
        , test "a confirmation for a different revision than the staged one is dropped" <|
            \_ ->
                let
                    r =
                        rev pausedValue "alice"
                in
                run (hostCtx pausedValue) [ WT.AskEnd r, WT.ConfirmEnd (rev "title=other" "alice") ] WT.blank
                    |> (\( m, fx ) -> ( m.endConfirm, m.pending, publishes fx ))
                    |> Expect.equal ( Nothing, Nothing, [] )
        , test "a non-host non-operator cannot even ask to end" <|
            \_ ->
                run (as_ (\c -> { c | canWrite = \_ -> False }) (ctxWith (Just "bob") (Just pausedValue))) [ WT.AskEnd (rev pausedValue "bob") ] WT.blank
                    |> (\( m, _ ) -> ( m.endConfirm, Maybe.map .tone m.notice ))
                    |> Expect.equal ( Nothing, Just WT.Problem )
        , test "an operator may end once the host has left the room, not before" <|
            \_ ->
                let
                    away =
                        as_ (\c -> { c | present = \_ n -> n /= "alice" }) (ctxWith (Just "bob") (Just pausedValue))

                    a =
                        WT.parse pausedValue |> Maybe.withDefault demo
                in
                Expect.equal
                    [ True, False ]
                    [ WT.canEnd away "#room" a
                    , WT.canEnd (ctxWith (Just "bob") (Just pausedValue)) "#room" a
                    ]
        , test "operators may take over only when the host is gone" <|
            \_ ->
                let
                    present =
                        ctxWith (Just "bob") (Just pausedValue)

                    away =
                        { present | present = \_ n -> n /= "alice" }
                in
                Expect.equal
                    [ [], [ True ] ]
                    [ run present [ WT.Claim (rev pausedValue "bob") ] WT.blank |> Tuple.second |> publishes |> List.map (String.contains "host=bob")
                    , run away [ WT.Claim (rev pausedValue "bob") ] WT.blank |> Tuple.second |> publishes |> List.map (String.contains "host=bob")
                    ]
        , test "hiding the card turns the preference off and says how to get it back" <|
            \_ ->
                run idle [ WT.Hide ] WT.blank
                    |> Tuple.second
                    |> Expect.equal [ WT.SetEnabled False, WT.Toast WT.Info "Watch together hidden" "Turn it back on from a room's More menu or in Preferences." ]
        ]



-- ── settling ───────────────────────────────────────────────────────────


settling : Test
settling =
    let
        pendingOf channel action =
            { blank_ | pending = Just { channel = channel, action = action, sentAt = now } }

        blank_ =
            WT.blank

        row =
            ":onyx.test 818 alice #room ocean.watch :title=x"

        end =
            ":onyx.test 819 alice #room :End of properties"
    in
    describe "server answers"
        [ test "818 for the room's ocean.watch confirms a start with a toast" <|
            \_ ->
                settle idle [ row ] (pendingOf "#room" WT.ActStart)
                    |> (\( m, fx ) -> ( m.pending, fx ))
                    |> Expect.equal ( Nothing, [ WT.Toast WT.Info "Watch together" "Watch activity started. You are hosting." ] )
        , test "818 confirms a mid-activity change on the card, not in a toast" <|
            \_ ->
                settle idle [ row ] (pendingOf "#room" WT.ActPause)
                    |> (\( m, fx ) -> ( Maybe.map .text m.notice, fx ))
                    |> Expect.equal ( Just "Paused for everyone.", [] )
        , test "818 for another key or another room is not ours" <|
            \_ ->
                settle idle [ ":onyx.test 818 alice #room topic :hi", ":onyx.test 818 alice #other ocean.watch :x" ] (pendingOf "#room" WT.ActStart)
                    |> (\( m, fx ) -> ( m.pending /= Nothing, fx ))
                    |> Expect.equal ( True, [] )
        , test "an 818 row does not confirm an end" <|
            \_ ->
                settle idle [ row ] (pendingOf "#room" WT.ActEnd)
                    |> (\( m, _ ) -> m.pending /= Nothing)
                    |> Expect.equal True
        , test "819 confirms an end: delete locally, focus the composer, close the card" <|
            \_ ->
                let
                    open =
                        { blank_ | expanded = True, rosterOpen = True, pending = Just { channel = "#room", action = WT.ActEnd, sentAt = now } }
                in
                settle idle [ end ] open
                    |> (\( m, fx ) -> ( ( m.pending, m.expanded, m.rosterOpen ), fx ))
                    |> Expect.equal
                        ( ( Nothing, False, False )
                        , [ WT.LocalDelete "#room", WT.Focus "shell-composer-input", WT.Toast WT.Info "Watch together" "Watch activity ended." ]
                        )
        , test "the 819 that ends a set does not delete anything" <|
            \_ ->
                settle idle [ end ] (pendingOf "#room" WT.ActPause)
                    |> (\( m, fx ) -> ( m.pending /= Nothing, fx ))
                    |> Expect.equal ( True, [] )
        , test "913 says only operators can change it" <|
            \_ ->
                settle idle [ ":onyx.test 913 alice #room :Insufficient access to set property" ] (pendingOf "#room" WT.ActPlay)
                    |> (\( m, _ ) -> ( m.pending, Maybe.map .tone m.notice, Maybe.map .text m.notice ))
                    |> Expect.equal ( Nothing, Just WT.Problem, Just "Onyx Server refused it: only room operators can change a watch activity." )
        , test "a refused start explains itself in a toast" <|
            \_ ->
                settle idle [ ":onyx.test 913 alice #room :Insufficient access to set property" ] (pendingOf "#room" WT.ActStart)
                    |> Tuple.second
                    |> Expect.equal [ WT.Toast WT.Problem "Watch activity not started" "Onyx Server refused it: only room operators can change a watch activity." ]
        , test "a refused end says it was not ended" <|
            \_ ->
                settle idle [ ":onyx.test 913 alice #room :Insufficient access to delete property" ] (pendingOf "#room" WT.ActEnd)
                    |> Tuple.second
                    |> Expect.equal [ WT.Toast WT.Problem "Watch activity not ended" "Onyx Server refused it: only room operators can change a watch activity." ]
        , test "461 for PROP means the value was refused as too long or malformed" <|
            \_ ->
                settle idle [ ":onyx.test 461 alice PROP :Invalid PROP" ] (pendingOf "#room" WT.ActSeek)
                    |> (\( m, _ ) -> Maybe.map .text m.notice)
                    |> Expect.equal (Just "Onyx Server rejected the update (too long or malformed).")
        , test "a 461 for another command is not ours" <|
            \_ ->
                settle idle [ ":onyx.test 461 alice JOIN :Not enough parameters" ] (pendingOf "#room" WT.ActSeek)
                    |> (\( m, _ ) -> m.pending /= Nothing)
                    |> Expect.equal True
        , test "nothing in flight means nothing to settle" <|
            \_ ->
                settle idle [ row, end ] WT.blank
                    |> Expect.equal ( WT.blank, [] )
        , test "a coalesced seek goes out once the previous change is confirmed" <|
            \_ ->
                let
                    value =
                        WT.serialize { demo | participants = [ "alice", "bob" ] }

                    waiting =
                        { blank_ | pending = Just { channel = "#room", action = WT.ActPlay, sentAt = now }, queuedSeek = Just ( "#room", 80 ) }
                in
                settle (ctxWith (Just "alice") (Just value)) [ row ] waiting
                    |> (\( m, fx ) -> ( m.queuedSeek, List.map (String.contains "position=80") (publishes fx) ))
                    |> Expect.equal ( Nothing, [ True ] )
        , test "ten seconds without an answer unblocks the controls and says so" <|
            \_ ->
                let
                    later =
                        { idle | nowMs = now + WT.pendingTimeoutMs }
                in
                WT.settleTick later (pendingOf "#room" WT.ActPlay)
                    |> (\m -> ( m.pending, Maybe.map .text m.notice ))
                    |> Expect.equal ( Nothing, Just "No answer from the server yet. The activity may not have changed." )
        , test "a younger change is not timed out" <|
            \_ ->
                WT.settleTick { idle | nowMs = now + 5000 } (pendingOf "#room" WT.ActPlay)
                    |> (\m -> m.pending /= Nothing)
                    |> Expect.equal True
        ]



-- ── room-scoped state ──────────────────────────────────────────────────


roomState : Test
roomState =
    let
        blank_ =
            WT.blank

        busyModel =
            { blank_
                | expanded = True
                , rosterOpen = True
                , handoffChoice = "bob"
                , scrub = Just ( "#room", 5 )
                , notice = Just { channel = "#room", text = "hi", tone = WT.Info }
                , endConfirm = Just (rev "title=x" "alice")
            }
    in
    describe "room-scoped state"
        [ test "switching rooms drops drafts, the roster, the confirmation and notices" <|
            \_ ->
                WT.settleRoom { channel = Just "#room", raw = Nothing } { idle | activeChannel = Just "#other" } busyModel
                    |> Expect.equal ( blank_, [] )
        , test "the same room with the same value changes nothing" <|
            \_ ->
                WT.settleRoom { channel = Just "#room", raw = Just "title=x" } (ctxWith (Just "alice") (Just "title=x")) busyModel
                    |> Expect.equal ( busyModel, [] )
        , test "a changed value retires a staged end confirmation" <|
            \_ ->
                WT.settleRoom { channel = Just "#room", raw = Just "title=x" } (ctxWith (Just "alice") (Just "title=y")) busyModel
                    |> (\( m, fx ) -> ( m.endConfirm, fx ))
                    |> Expect.equal ( Nothing, [ WT.Focus "watch-status" ] )
        , test "an activity appearing during a review retires the review" <|
            \_ ->
                let
                    ( reviewing, _ ) =
                        run idle [ WT.MenuSelect "#room", WT.EditTitle "Night", WT.EditorReview ] WT.blank
                in
                WT.settleRoom { channel = Just "#room", raw = Nothing } (ctxWith (Just "alice") (Just "title=Theirs")) reviewing
                    |> (\( m, fx ) -> ( m.editor, fx ))
                    |> Expect.equal
                        ( Nothing
                        , [ WT.Toast WT.Problem "Watch activity not started" "A watch activity started in #room while you were reviewing, so nothing was replaced." ]
                        )
        , test "an activity ending closes the roster and the scrub" <|
            \_ ->
                WT.settleRoom { channel = Just "#room", raw = Just "title=x" } idle busyModel
                    |> (\( m, _ ) -> ( m.rosterOpen, m.scrub ))
                    |> Expect.equal ( False, Nothing )
        , test "toggles" <|
            \_ ->
                let
                    ( a, _ ) =
                        run idle [ WT.ToggleExpanded, WT.ToggleRoster ] WT.blank

                    ( b, _ ) =
                        run idle [ WT.ToggleExpanded ] a
                in
                Expect.equal ( ( True, True ), ( False, False ) ) ( ( a.expanded, a.rosterOpen ), ( b.expanded, b.rosterOpen ) )
        , test "a context built from room data reads who may write and who is present" <|
            \_ ->
                let
                    model =
                        { nowMs = now
                        , ourNick = "Alice"
                        , activeChannel = Just "#Room"
                        , isOper = False
                        , prefs = { watchTogether = True }
                        , props = { channelProps = Dict.fromList [ ( "#room", Dict.fromList [ ( "ocean.watch", "title=x" ) ] ) ] }
                        , channels =
                            Dict.fromList
                                [ ( "#room"
                                  , { members =
                                        Dict.fromList
                                            [ ( "alice", { modes = Set.fromList [ 'o' ] } )
                                            , ( "bob", { modes = Set.fromList [ 'v' ] } )
                                            , ( "carol", { modes = Set.empty } )
                                            ]
                                    }
                                  )
                                ]
                        }

                    ctx =
                        WT.context True model
                in
                Expect.equal
                    ( ( Just "Alice", Just "title=x", True )
                    , ( ( True, False ), ( True, False ) )
                    )
                    ( ( ctx.self, ctx.rawFor "#ROOM", ctx.enabled )
                    , ( ( ctx.canWrite "#room", (WT.context True { model | ourNick = "bob" }).canWrite "#room" ), ( ctx.present "#room" "carol", ctx.isOperator "#room" "bob" ) )
                    )
        , test "an IRC oper may write anywhere" <|
            \_ ->
                let
                    ctx =
                        WT.context True
                            { nowMs = now
                            , ourNick = "root"
                            , activeChannel = Nothing
                            , isOper = True
                            , prefs = { watchTogether = False }
                            , props = { channelProps = Dict.empty }
                            , channels = Dict.empty
                            }
                in
                Expect.equal ( True, False ) ( ctx.canWrite "#anywhere", ctx.enabled )
        ]
