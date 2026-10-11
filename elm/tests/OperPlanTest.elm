module OperPlanTest exposing (suite)

{-| v3/gap-oper — what the desk sends, verbatim, for every network
command (bans, silencing, abuse insight, appeals, content controls), and
what it refuses before sending.
-}

import Expect
import OperPlan exposing (BanKind(..), Intent(..))
import Test exposing (Test, describe, test)


forever : OperPlan.Duration
forever =
    OperPlan.blankDuration


hours : String -> OperPlan.Duration
hours n =
    { choice = "custom", amount = n, unit = "hours" }


line : Intent -> Result (List String) String
line intent =
    OperPlan.plan intent |> Result.map OperPlan.preview


wire : Intent -> Result (List String) String
wire intent =
    OperPlan.plan intent |> Result.map OperPlan.toLine


ban : BanKind -> String -> OperPlan.BanForm
ban kind pattern =
    { kind = kind, match = "mask", pattern = pattern, scope = "node", action = "expel", duration = forever, reason = "spam wave" }


suite : Test
suite =
    describe "v3/gap-oper OperPlan"
        [ describe "bans"
            [ test "K-line, permanent: reason rides as trailing text" <|
                \_ -> Expect.equal (Ok "KLINE ADD *!*@bad.example :spam wave") (line (BanAdd (ban Kline "*!*@bad.example")))
            , test "K-line with a duration puts the seconds before the reason" <|
                \_ ->
                    Expect.equal (Ok "KLINE ADD *!*@bad.example 86400 :spam wave")
                        (line (BanAdd (let f = ban Kline "*!*@bad.example" in { f | duration = { choice = "86400", amount = "", unit = "hours" } })))
            , test "D-line takes an address and keeps the refuse default server-side" <|
                \_ ->
                    Expect.equal (Ok "DLINE ADD 203.0.113.0/24 3600 :botnet")
                        (line (BanAdd (let f = ban Dline "203.0.113.0/24" in { f | duration = { choice = "3600", amount = "", unit = "hours" }, reason = "botnet" })))
            , test "an address needs no literal-byte policy (CIDR is exempt, as on the server)" <|
                \_ -> Expect.equal (Ok "DLINE ADD 10.0.0.0/8 :scanner net") (line (BanAdd (let f = ban Dline "10.0.0.0/8" in { f | reason = "scanner net" })))
            , test "X-line" <|
                \_ -> Expect.equal (Ok "XLINE ADD *bad?bot* :bot name") (line (BanAdd (let f = ban Xline "*bad?bot*" in { f | reason = "bot name" })))
            , test "a custom ward names facet, scope, action and duration" <|
                \_ ->
                    Expect.equal (Ok "WARD ADD country RU mesh quarantine 604800 :raid wave")
                        (line
                            (BanAdd
                                { kind = Ward
                                , match = "country"
                                , pattern = "RU"
                                , scope = "mesh"
                                , action = "quarantine"
                                , duration = { choice = "604800", amount = "", unit = "hours" }
                                , reason = "raid wave"
                                }
                            )
                        )
            , test "a custom duration converts to seconds" <|
                \_ ->
                    Expect.equal (Ok "KLINE ADD *!*@bad.example 7200 :spam wave")
                        (line (BanAdd (let f = ban Kline "*!*@bad.example" in { f | duration = hours "2" })))
            , test "a one-word numeric reason cannot be mistaken for a duration" <|
                \_ ->
                    Expect.equal (Ok "WARD ADD mask *!*@bad.example node expel :1234")
                        (line (BanAdd (let f = ban Ward "*!*@bad.example" in { f | reason = "1234" })))
            , test "the wire line ends in CRLF" <|
                \_ -> Expect.equal (Ok "KLINE ADD *!*@bad.example :spam wave\u{000D}\n") (wire (BanAdd (ban Kline "*!*@bad.example")))
            , test "a catch-all mask is refused before sending" <|
                \_ ->
                    Expect.equal True
                        (case OperPlan.plan (BanAdd (ban Kline "*!*@*")) of
                            Err messages ->
                                List.any (String.contains "too much") messages

                            Ok _ ->
                                False
                        )
            , test "a ban needs a reason" <|
                \_ -> Expect.equal True (isErr (OperPlan.plan (BanAdd (let f = ban Kline "*!*@bad.example" in { f | reason = "  " }))))
            , test "a reason with a line break is refused" <|
                \_ -> Expect.equal True (isErr (OperPlan.plan (BanAdd (let f = ban Kline "*!*@bad.example" in { f | reason = "a\nb c" }))))
            , test "a pattern with a space is refused" <|
                \_ -> Expect.equal True (isErr (OperPlan.plan (BanAdd (ban Kline "bad guy!*@x.example"))))
            , test "a pattern that starts with a colon is refused" <|
                \_ -> Expect.equal True (isErr (OperPlan.plan (BanAdd (ban Kline ":*!*@bad.example"))))
            , test "a ward needs a real facet, scope and action" <|
                \_ ->
                    Expect.equal True
                        (isErr (OperPlan.plan (BanAdd { kind = Ward, match = "nope", pattern = "x.example", scope = "galaxy", action = "vaporize", duration = forever, reason = "because" })))
            , test "an empty custom duration is refused" <|
                \_ -> Expect.equal True (isErr (OperPlan.plan (BanAdd (let f = ban Kline "*!*@bad.example" in { f | duration = hours "" }))))
            , test "ban adds stage for review as destructive" <|
                \_ ->
                    Expect.equal (Ok ( True, True ))
                        (OperPlan.plan (BanAdd (ban Kline "*!*@bad.example")) |> Result.map (\c -> ( c.mutates, c.destructive )))
            , test "lifting a ban stages for review but is not destructive" <|
                \_ ->
                    Expect.equal (Ok ( "WARD DEL mask *!*@bad.example", True, False ))
                        (OperPlan.plan (BanRemove { match = "mask", pattern = "*!*@bad.example" })
                            |> Result.map (\c -> ( OperPlan.preview c, c.mutates, c.destructive ))
                        )
            , test "reads send at once" <|
                \_ ->
                    Expect.equal (Ok ( "WARD LIST", False ))
                        (OperPlan.plan BanList |> Result.map (\c -> ( OperPlan.preview c, c.mutates )))
            , test "WARD TEST, TESTLINE and TESTMASK" <|
                \_ ->
                    Expect.equal
                        [ Ok "WARD TEST host bad.example", Ok "TESTLINE bob!u@bad.example", Ok "TESTMASK *!*@bad.example" ]
                        [ line (BanTest { match = "host", value = "bad.example" })
                        , line (TestLine "bob!u@bad.example")
                        , line (TestMask "*!*@bad.example")
                        ]
            , test "tooBroad mirrors the server policy" <|
                \_ ->
                    Expect.equal [ True, True, False, False, True, False ]
                        (List.map OperPlan.tooBroad [ "*!*@*", "a*", "*!*@bad.example", "ab\\*c", "*a*b*c*d*ef", "bad??" ])
            ]
        , describe "silencing"
            [ test "SHUN with a duration and reason" <|
                \_ ->
                    Expect.equal (Ok "SHUN *!*@bad.example 3600 :flooding")
                        (line (ShunAdd { mask = "*!*@bad.example", duration = { choice = "3600", amount = "", unit = "hours" }, reason = "flooding" }))
            , test "a permanent SHUN omits the seconds" <|
                \_ ->
                    Expect.equal (Ok "SHUN *!*@bad.example :flooding")
                        (line (ShunAdd { mask = "*!*@bad.example", duration = forever, reason = "flooding" }))
            , test "a shun that matches everyone is refused" <|
                \_ -> Expect.equal True (isErr (OperPlan.plan (ShunAdd { mask = "*!*@*", duration = forever, reason = "oops" })))
            , test "UNSHUN and the bare SHUN list" <|
                \_ -> Expect.equal [ Ok "UNSHUN *!*@bad.example", Ok "SHUN" ] [ line (ShunRemove "*!*@bad.example"), line ShunList ]
            , test "GAG rides on MODE +z and -z" <|
                \_ -> Expect.equal [ Ok "MODE bob +z", Ok "MODE bob -z" ] [ line (GagUser { nick = "bob", on = True }), line (GagUser { nick = "bob", on = False }) ]
            , test "GAG refuses a wildcard nick" <|
                \_ -> Expect.equal True (isErr (OperPlan.plan (GagUser { nick = "b*", on = True })))
            , test "QUARANTINE names the nick, the room and the reason" <|
                \_ ->
                    Expect.equal (Ok "QUARANTINE bob #quarantine :spam wave")
                        (line (Quarantine { nick = "bob", channel = "#quarantine", reason = "spam wave" }))
            , test "QUARANTINE needs a channel" <|
                \_ -> Expect.equal True (isErr (OperPlan.plan (Quarantine { nick = "bob", channel = "quarantine", reason = "spam wave" })))
            ]
        , describe "abuse insight"
            [ test "ABUSE and CLONES" <|
                \_ -> Expect.equal [ Ok "ABUSE bob", Ok "CLONES" ] [ line (AbuseCheck "bob"), line ClonesScan ]
            , test "SESSIONS packs its filter into ONE trailing parameter" <|
                \_ ->
                    Expect.equal (Ok "SESSIONS :oper tls account=* ip=203.0.113.* sort=-connected limit=20")
                        (line (SessionsList { who = "oper", transport = "tls", account = "*", ip = "203.0.113.*", sort = "-connected", limit = "20" }))
            , test "SESSIONS with no filters is bare" <|
                \_ -> Expect.equal (Ok "SESSIONS") (line (SessionsList { who = "", transport = "", account = "", ip = "", sort = "", limit = "" }))
            , test "SESSIONS refuses an unknown sort key and a silly limit" <|
                \_ ->
                    Expect.equal [ True, True, True ]
                        [ isErr (OperPlan.plan (SessionsList { who = "", transport = "", account = "", ip = "", sort = "-bogus", limit = "" }))
                        , isErr (OperPlan.plan (SessionsList { who = "", transport = "", account = "", ip = "", sort = "xnick", limit = "" }))
                        , isErr (OperPlan.plan (SessionsList { who = "", transport = "", account = "", ip = "", sort = "", limit = "9999" }))
                        ]
            ]
        , describe "appeals"
            [ test "the user files with APPEAL :text" <|
                \_ -> Expect.equal (Ok "APPEAL :Please look again, the ban was a mistake") (line (AppealSubmit "Please look again, the ban was a mistake"))
            , test "an empty appeal and an over-long appeal are refused" <|
                \_ -> Expect.equal [ True, True ] [ isErr (OperPlan.plan (AppealSubmit "  ")), isErr (OperPlan.plan (AppealSubmit (String.repeat 401 "a"))) ]
            , test "an oper lists and answers" <|
                \_ ->
                    Expect.equal [ Ok "APPEAL LIST", Ok "APPEAL ANSWER 4 :Ban lifted, sorry" ]
                        [ line AppealsList, line (AppealAnswer { id = "4", text = "Ban lifted, sorry" }) ]
            , test "an answer needs an appeal and text" <|
                \_ ->
                    Expect.equal [ True, True ]
                        [ isErr (OperPlan.plan (AppealAnswer { id = "", text = "ok" })), isErr (OperPlan.plan (AppealAnswer { id = "4", text = "" })) ]
            , test "an answer is a staged change" <|
                \_ -> Expect.equal (Ok True) (OperPlan.plan (AppealAnswer { id = "4", text = "ok then" }) |> Result.map .mutates)
            ]
        , describe "content controls"
            [ test "FILTER patterns keep their spaces by riding as trailing text" <|
                \_ ->
                    Expect.equal [ Ok "FILTER ADD :free money", Ok "FILTER DEL :free money", Ok "FILTER LIST" ]
                        [ line (FilterAdd "free money"), line (FilterRemove "free money"), line FilterList ]
            , test "a tiny filter pattern is refused (it would block ordinary words)" <|
                \_ -> Expect.equal True (isErr (OperPlan.plan (FilterAdd "ab")))
            , test "SPAMTRAP add and delete for a nick and a channel" <|
                \_ ->
                    Expect.equal [ Ok "SPAMTRAP ADD NICK honeypot", Ok "SPAMTRAP DEL CHAN #trap", Ok "SPAMTRAP LIST" ]
                        [ line (SpamtrapSet { add = True, kind = "NICK", target = "honeypot" })
                        , line (SpamtrapSet { add = False, kind = "CHAN", target = "#trap" })
                        , line SpamtrapStatus
                        ]
            , test "HOLD release and drop" <|
                \_ ->
                    Expect.equal [ Ok "HOLD RELEASE #lounge bob", Ok "HOLD DROP #lounge bob" ]
                        [ line (HoldAct { release = True, channel = "#lounge", nick = "bob" }), line (HoldAct { release = False, channel = "#lounge", nick = "bob" }) ]
            , test "dropping held messages is destructive, releasing is not" <|
                \_ ->
                    Expect.equal [ Ok False, Ok True ]
                        [ OperPlan.plan (HoldAct { release = True, channel = "#c", nick = "bob" }) |> Result.map .destructive
                        , OperPlan.plan (HoldAct { release = False, channel = "#c", nick = "bob" }) |> Result.map .destructive
                        ]
            , test "POLICY list and rollback (rollback is destructive)" <|
                \_ ->
                    Expect.equal [ Ok "POLICY LIST", Ok "POLICY ROLLBACK" ] [ line PolicyShow, line PolicyRollback ]
            , test "CHALLENGE method and question" <|
                \_ ->
                    Expect.equal [ Ok "CHALLENGE METHOD pow", Ok "CHALLENGE METHOD question", Ok "CHALLENGE QUESTION type_the_word_cat :cat" ]
                        [ line (ChallengeMethod "pow"), line (ChallengeMethod "question"), line (ChallengeQuestion { question = "type the word cat", answer = "cat" }) ]
            , test "an unknown challenge method is refused" <|
                \_ -> Expect.equal True (isErr (OperPlan.plan (ChallengeMethod "captcha")))
            ]
        , describe "event spine"
            [ test "follow, unfollow, floor, list and stats" <|
                \_ ->
                    Expect.equal [ Ok "EVENT ADD FLOOD", Ok "EVENT DEL FLOOD", Ok "EVENT SEVERITY warn", Ok "EVENT LIST", Ok "EVENT STATS JSON" ]
                        [ line (Follow { category = "FLOOD", on = True })
                        , line (Follow { category = "FLOOD", on = False })
                        , line (MinSeverity "warn")
                        , line EventsReport
                        , line EventStats
                        ]
            , test "an unknown severity floor is refused" <|
                \_ -> Expect.equal True (isErr (OperPlan.plan (MinSeverity "loud")))
            ]
        ]


isErr : Result e a -> Bool
isErr result =
    case result of
        Err _ ->
            True

        Ok _ ->
            False
