module OperReplyTest exposing (suite)

{-| v3/gap-oper — the daemon's operator reply shapes, one wire vector per
shape (`oper_cmd.zig`, `server.zig`, `svc_sessionview.zig`). Every line
below is copied from the format string the server writes.
-}

import Expect
import OperReply exposing (Reply(..), Section(..), Tone(..))
import Test exposing (Test, describe, test)
import Wire


read : String -> Maybe Reply
read line =
    OperReply.classify (Wire.parseIrcMessage line)


notice : String -> String
notice text =
    ":onyx.test NOTICE root :" ++ text


expectReply : Reply -> String -> Expect.Expectation
expectReply expected line =
    Expect.equal (Just expected) (read line)


suite : Test
suite =
    describe "v3/gap-oper OperReply"
        [ describe "bans"
            [ test "a ward row" <|
                \_ ->
                    expectReply
                        (WardRow { match = "mask", pattern = "*!*@bad.example", scope = "node", action = "expel", setBy = "root", reason = "spam wave" })
                        (notice "WARD mask *!*@bad.example node/expel by root :spam wave")
            , test "a ward row with an empty reason" <|
                \_ ->
                    expectReply
                        (WardRow { match = "address", pattern = "203.0.113.0/24", scope = "mesh", action = "refuse", setBy = "ops", reason = "" })
                        (notice "WARD address 203.0.113.0/24 mesh/refuse by ops")
            , test "end of the ward list" <|
                \_ -> expectReply WardEnd (notice "WARD: end of list")
            , test "WARD TEST matched and unmatched" <|
                \_ ->
                    Expect.equal
                        [ Just (WardTested { matched = True, text = "mask *!*@bad.example (expel) :spam wave" })
                        , Just (WardTested { matched = False, text = "No ward matches that value." })
                        ]
                        [ read (notice "WARD TEST: matched mask *!*@bad.example (expel) :spam wave")
                        , read (notice "WARD TEST: no match")
                        ]
            , test "ward refusals are said in the Bans section" <|
                \_ ->
                    Expect.equal
                        [ Just (Said { section = Bans, text = "WARD: pattern too broad (needs more literal characters)" })
                        , Just (Said { section = Bans, text = "WARD: could not add ward (limit or invalid input)" })
                        ]
                        [ read (notice "WARD: pattern too broad (needs more literal characters)")
                        , read (notice "WARD: could not add ward (limit or invalid input)")
                        ]
            , test "TESTLINE: 725 matched, 726 not matched, 727 TESTMASK count" <|
                \_ ->
                    Expect.equal
                        [ Just (LineTested { target = "*!*@bad.example", matchedBy = Just { match = "mask", pattern = "*!*@bad.example", reason = "spam wave" } })
                        , Just (LineTested { target = "bob!u@h.example", matchedBy = Nothing })
                        , Just (MaskTested { mask = "*!*@h.example", count = 3 })
                        ]
                        [ read ":onyx.test 725 root mask *!*@bad.example :spam wave"
                        , read ":onyx.test 726 root bob!u@h.example :No matching ban found"
                        , read ":onyx.test 727 root *!*@h.example 3 :clients match"
                        ]
            ]
        , describe "silence"
            [ test "a shun row and the end of the list" <|
                \_ ->
                    Expect.equal
                        [ Just (ShunRow { mask = "*!*@bad.example", setBy = "root", reason = "No reason" }), Just ShunEnd ]
                        [ read (notice "SHUN *!*@bad.example by root :No reason"), read (notice "SHUN: end of list") ]
            , test "shun refusals" <|
                \_ ->
                    Expect.equal
                        [ Just (Said { section = Silence, text = "SHUN: mask too broad (needs more literal characters)" })
                        , Just (Said { section = Silence, text = "SHUN: could not add (limit or invalid mask)" })
                        ]
                        [ read (notice "SHUN: mask too broad (needs more literal characters)")
                        , read (notice "SHUN: could not add (limit or invalid mask)")
                        ]
            , test "the +z GAG reflection" <|
                \_ ->
                    Expect.equal
                        [ Just (GagSet { nick = "bob", on = True }), Just (GagSet { nick = "bob", on = False }) ]
                        [ read ":onyx.test MODE bob +z", read ":onyx.test MODE bob -z" ]
            , test "a channel mode that ends in z is not a gag" <|
                \_ -> Expect.equal Nothing (read ":onyx.test MODE #lounge +z")
            , test "quarantine moved" <|
                \_ -> expectReply QuarantineMoved (notice "QUARANTINE moved")
            ]
        , describe "abuse"
            [ test "ABUSE facts" <|
                \_ ->
                    Expect.equal
                        [ Just (AbuseFact { nick = "bob", topic = "flood", detail = "none excess=0 message_tokens=12" })
                        , Just (AbuseFact { nick = "bob", topic = "shun", detail = "no" })
                        , Just (AbuseFact { nick = "bob", topic = "dnsbl", detail = "listed 2" })
                        , Just (AbuseFact { nick = "bob", topic = "reputation", detail = "14" })
                        , Just (AbuseFact { nick = "bob", topic = "account", detail = "bobby score=3" })
                        , Just AbuseNoNick
                        ]
                        [ read (notice "ABUSE bob: flood none excess=0 message_tokens=12")
                        , read (notice "ABUSE bob: shun no")
                        , read (notice "ABUSE bob: dnsbl listed 2")
                        , read (notice "ABUSE bob: reputation 14")
                        , read (notice "ABUSE bob: account bobby score=3")
                        , read (notice "ABUSE: no such nick")
                        ]
            , test "CLONES policy, throttle and header lines" <|
                \_ ->
                    Expect.equal
                        [ Just (ClonesPolicy "CLONES policy: max_per_ip=3 (on) max_per_net=0 (off); per-class clone caps via STATS Y")
                        , Just (ClonesPolicy "CLONES throttle: disabled (set [limits] throttle_connects)")
                        , Just (ClonesHeader { kind = "ip", key = "203.0.113.9", count = 3 })
                        , Just (ClonesHeader { kind = "net", key = "203.0.113.0/24", count = 5 })
                        , Just ClonesNone
                        ]
                        [ read (notice "CLONES policy: max_per_ip=3 (on) max_per_net=0 (off); per-class clone caps via STATS Y")
                        , read (notice "CLONES throttle: disabled (set [limits] throttle_connects)")
                        , read (notice "CLONES ip 203.0.113.9 (3 clients)")
                        , read (notice "CLONES net 203.0.113.0/24 (5 clients)")
                        , read (notice "CLONES: no clone clusters found")
                        ]
            , test "a clone member line reads nick, address and account" <|
                \_ ->
                    Expect.equal
                        [ Just { nick = "alice", ip = "203.0.113.9", account = "*" }
                        , Just { nick = "bob", ip = "203.0.113.9", account = "bobby" }
                        , Nothing
                        ]
                        [ OperReply.parseCloneMember "  alice 203.0.113.9 *"
                        , OperReply.parseCloneMember "  bob 203.0.113.9 bobby [US]"
                        , OperReply.parseCloneMember "alice 203.0.113.9 *"
                        ]
            , test "SESSIONS rows (204 oper, 205 user) and the 262 terminator" <|
                \_ ->
                    Expect.equal
                        [ Just (SessionRow { oper = True, nick = "RootOper", ip = "198.51.100.7", seconds = 90, tls = True, account = "root" })
                        , Just (SessionRow { oper = False, nick = "Bob", ip = "203.0.113.9", seconds = 60, tls = False, account = "*" })
                        , Just SessionsEnd
                        ]
                        [ read ":onyx.test 204 RootOper Oper sessions RootOper (198.51.100.7) 90 0 tls root"
                        , read ":onyx.test 205 RootOper User sessions Bob (203.0.113.9) 60 0 clear *"
                        , read ":onyx.test 262 RootOper SESSION :End of SESSION view"
                        ]
            , test "a TRACE row is not a SESSIONS row" <|
                \_ -> Expect.equal Nothing (read ":onyx.test 205 RootOper User users Bob (203.0.113.9) 60 0 clear *")
            ]
        , describe "appeals"
            [ test "list rows, open and answered" <|
                \_ ->
                    Expect.equal
                        [ Just (AppealRow { id = 1, nick = "bob", host = "203.0.113.9", answered = False, text = "please review the ban" })
                        , Just (AppealRow { id = 2, nick = "ann", host = "h.example", answered = True, text = "wrong person" })
                        ]
                        [ read (notice "APPEAL 1 bob 203.0.113.9 open :please review the ban")
                        , read (notice "APPEAL 2 ann h.example answered :wrong person")
                        ]
            , test "the one-line outcomes" <|
                \_ ->
                    Expect.equal
                        [ Just AppealNone, Just (AppealFiled 12), Just AppealAlready, Just AppealAnswered, Just AppealNoSuchId ]
                        [ read (notice "APPEAL none")
                        , read (notice "APPEAL filed 12")
                        , read (notice "APPEAL already filed")
                        , read (notice "APPEAL answered")
                        , read (notice "APPEAL no such id")
                        ]
            ]
        , describe "content controls"
            [ test "filter rows and the end of the list" <|
                \_ ->
                    Expect.equal
                        [ Just (FilterRow { index = 1, pattern = "free money" })
                        , Just (FilterRow { index = 2, pattern = "buy followers now" })
                        , Just (FilterEnd 2)
                        , Just (FilterChanged { added = True })
                        , Just (FilterChanged { added = False })
                        ]
                        [ read (notice "FILTER LIST #1 free money")
                        , read (notice "FILTER LIST #2 buy followers now")
                        , read (notice "FILTER: End of filter list (2)")
                        , read (notice "FILTER: pattern added")
                        , read (notice "FILTER: pattern removed")
                        ]
            , test "FAIL FILTER codes" <|
                \_ ->
                    Expect.equal
                        (Just (Failed { command = "FILTER", code = "INVALID_PATTERN", text = "Pattern empty, too long, full, or duplicate" }))
                        (read ":onyx.test FAIL FILTER INVALID_PATTERN :Pattern empty, too long, full, or duplicate")
            , test "SPAMTRAP summary" <|
                \_ ->
                    expectReply
                        (SpamtrapSummary { nicks = 2, channels = 1, offenders = 0, trips = 5 })
                        (notice "SPAMTRAP: 2 trap nick(s), 1 trap channel(s), 0 offender(s), 5 total trip(s)")
            , test "SPAMTRAP changes are said in Content" <|
                \_ ->
                    expectReply (Said { section = Content, text = "SPAMTRAP ADD NICK honeypot" }) (notice "SPAMTRAP ADD NICK honeypot")
            , test "HOLD released and dropped" <|
                \_ ->
                    Expect.equal
                        [ Just (HoldDone { released = True, count = 3 }), Just (HoldDone { released = False, count = 1 }) ]
                        [ read (notice "HOLD released 3"), read (notice "HOLD dropped 1") ]
            , test "POLICY generations and rollback" <|
                \_ ->
                    Expect.equal
                        [ Just (PolicyGenerations { ward = 4, filter = 2, class = 1, ban = 7 })
                        , Just (PolicyRolled "POLICY: rolled ward back to generation 3")
                        , Just (Said { section = Content, text = "POLICY: nothing to roll back" })
                        ]
                        [ read (notice "POLICY: ward=4 filter=2 class=1 ban=7")
                        , read (notice "POLICY: rolled ward back to generation 3")
                        , read (notice "POLICY: nothing to roll back")
                        ]
            , test "CHALLENGE acknowledgements" <|
                \_ ->
                    Expect.equal
                        [ Just (Said { section = Content, text = "CHALLENGE method set" }), Just (Said { section = Content, text = "CHALLENGE question set" }) ]
                        [ read (notice "CHALLENGE method set"), read (notice "CHALLENGE question set") ]
            ]
        , describe "two-person rule"
            [ test "a mesh ward waits for a second operator" <|
                \_ -> expectReply SecondOperator (notice "waiting for a second operator")
            ]
        , describe "event spine commands"

            [ test "EVENT LIST category line" <|
                \_ ->
                    Expect.equal
                        [ Just (EventCategories { subscribed = [ "CONNECT", "FLOOD" ], minSeverity = "debug" })
                        , Just (EventCategories { subscribed = [], minSeverity = "warn" })
                        ]
                        [ read (notice "Event categories: CONNECT FLOOD (min severity: debug)")
                        , read (notice "Event categories: (none) (min severity: warn)")
                        ]
            , test "EVENT SEVERITY replies" <|
                \_ ->
                    Expect.equal
                        [ Just (EventSeverityIs "Event minimum severity set to warn")
                        , Just (EventSeverityIs "Unknown severity; use debug|info|notice|warn|error|critical")
                        ]
                        [ read (notice "Event minimum severity set to warn")
                        , read (notice "Unknown severity; use debug|info|notice|warn|error|critical")
                        ]
            , test "EVENT STATS lines" <|
                \_ ->
                    Expect.equal
                        [ Just (EventStatsText "Event stats since boot: 12 total, 12 in history ring")
                        , Just (EventStatsText "  by category: CONNECT=8 FLOOD=4")
                        ]
                        [ read (notice "Event stats since boot: 12 total, 12 in history ring")
                        , read (notice "  by category: CONNECT=8 FLOOD=4")
                        ]
            ]
        , describe "numerics"
            [ test "PRIVS (270) reads the class and privileges" <|
                \_ ->
                    expectReply
                        (PrivilegeList { class = "admin", privileges = [ "client_kill", "client_moderate", "server_rehash" ] })
                        ":onyx.test 270 root root admin :client_kill client_moderate server_rehash"
            , test "REHASH (382)" <|
                \_ ->
                    expectReply (RehashDone "Configuration reloaded (2 oper bindings; TLS certificates unchanged)")
                        ":onyx.test 382 root /etc/onyx/onyx_server.conf :Configuration reloaded (2 oper bindings; TLS certificates unchanged)"
            , test "481, 461 and 401" <|
                \_ ->
                    Expect.equal
                        [ Just (Denied "Permission denied: requires the 'client_moderate' operator privilege")
                        , Just (NeedParams { command = "KILL", text = "Not enough parameters" })
                        , Just (NoSuchNick "ghost")
                        ]
                        [ read ":onyx.test 481 root :Permission denied: requires the 'client_moderate' operator privilege"
                        , read ":onyx.test 461 root KILL :Not enough parameters"
                        , read ":onyx.test 401 root ghost :No such nick"
                        ]
            ]
        , describe "forgery and shape guards"
            [ test "a person's NOTICE is never a desk reply" <|
                \_ -> Expect.equal Nothing (read ":mallory!m@evil.example NOTICE root :WARD: end of list")
            , test "unrelated server notices are not claimed" <|
                \_ -> Expect.equal Nothing (read (notice "Welcome back"))
            , test "numeric error classifier" <|
                \_ ->
                    Expect.equal [ True, True, True, False, False ]
                        (List.map OperReply.isErrorNumeric [ "401", "481", "913", "372", "PRIVMSG" ])
            ]
        , describe "presentation"
            [ test "replies know their section and tone" <|
                \_ ->
                    Expect.equal
                        [ ( Just Bans, Just Plain ), ( Just Appeals, Just Good ), ( Just Network, Just Bad ), ( Just Silence, Just Good ) ]
                        (List.map
                            (\line -> ( Maybe.map OperReply.sectionOf (read line), Maybe.map OperReply.toneOf (read line) ))
                            [ notice "WARD: end of list"
                            , notice "APPEAL filed 3"
                            , ":onyx.test 481 root :Permission denied"
                            , ":onyx.test MODE bob +z"
                            ]
                        )
            , test "a refusal said by the server reads as a warning" <|
                \_ ->
                    Expect.equal (Just Warn)
                        (read (notice "SHUN: mask too broad (needs more literal characters)") |> Maybe.map OperReply.toneOf)
            , test "descriptions are plain sentences" <|
                \_ ->
                    Expect.equal
                        [ "Ward mask *!*@bad.example (node, expel) set by root — spam wave"
                        , "bob is gagged."
                        , "3 held messages released."
                        ]
                        (List.map OperReply.describe
                            [ WardRow { match = "mask", pattern = "*!*@bad.example", scope = "node", action = "expel", setBy = "root", reason = "spam wave" }
                            , GagSet { nick = "bob", on = True }
                            , HoldDone { released = True, count = 3 }
                            ]
                        )
            ]
        ]
