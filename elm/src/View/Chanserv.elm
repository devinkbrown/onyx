module View.Chanserv exposing
    ( composerSlowWaiting
    , joinPromptActions
    , joinPromptCard
    , knockAction
    , listsSection
    , moreRules
    , muteButton
    , myRoomsSection
    , paceSection
    , registrationSection
    , slowNote
    )

{-| v3/gap-chanserv — the surfaces for registered-room services and the
channel-operator tools (pure core in `Chanserv`, wiring in App's
`-- v3/gap-chanserv` block).

Room settings keeps its calm order: everyday sections stay on top
(Topic, Notifications, then "Welcome and slow mode", which members see
only when something is set). Everything else waits inside the existing
"Advanced" disclosure, and each heavy part sits in its own nested
disclosure: "More rules" under Room rules, then Registration and
"Mutes and exceptions" for hosts. Mode letters never reach the screen;
they live only in `data-testid`s.

Outside the sheet: a join-refusal card (Ask to join / room key), the
hosts' "asks to join" rows in the inbox, the composer's slow-mode line
and a Mute action on the member card.

-}

import App exposing (Model, Msg(..), NotificationType(..))
import Chanserv exposing (Registration(..), Tone(..))
import Dict
import Html exposing (Html, button, details, div, form, h3, h4, input, label, li, option, p, section, select, span, summary, text, textarea, ul)
import Html.Attributes exposing (attribute, class, classList, disabled, for, id, selected, type_, value)
import Html.Events exposing (on, onClick, onInput, onSubmit)
import Json.Decode as Decode
import Modes
import RoomSettings
import Set
import Time


cs : Chanserv.Msg -> Msg
cs =
    ChanservMsg



-- SHARED BITS


sectionWith : String -> String -> List (Html Msg) -> Html Msg
sectionWith key heading body =
    section [ class "rset-section cs-section", attribute "aria-labelledby" ("chset-" ++ key ++ "-heading"), attribute "data-testid" ("chset-" ++ key) ]
        (h3 [ id ("chset-" ++ key ++ "-heading"), class "rset-heading" ] [ text heading ] :: body)


readonly : String -> String -> String -> String -> Html Msg
readonly testId labelText valueText hint =
    div [ class "rset-readonly", attribute "data-testid" testId ]
        ([ p [ class "rset-readonly-label" ] [ text labelText ]
         , p [ class "rset-readonly-value" ] [ text valueText ]
         ]
            ++ (if String.isEmpty hint then
                    []

                else
                    [ p [ class "rset-hint" ] [ text hint ] ]
               )
        )


changeTo : (String -> Msg) -> Html.Attribute Msg
changeTo toMsg =
    on "change" (Decode.map toMsg (Decode.at [ "target", "value" ] Decode.string))


{-| A `details` that asks for its data the first time it opens. -}
onOpen : Msg -> Html.Attribute Msg
onOpen msg =
    on "toggle"
        (Decode.at [ "target", "open" ] Decode.bool
            |> Decode.andThen
                (\open ->
                    if open then
                        Decode.succeed msg

                    else
                        Decode.fail "closed"
                )
        )


selectField : { id : String, current : String, options : List ( String, String ), toMsg : String -> Msg, describedBy : String, testId : String } -> Html Msg
selectField cfg =
    select
        [ id cfg.id
        , class "rset-select"
        , value cfg.current
        , attribute "aria-describedby" cfg.describedBy
        , attribute "data-testid" cfg.testId
        , changeTo cfg.toMsg
        ]
        (List.map (\( v, l ) -> option [ value v, selected (v == cfg.current) ] [ text l ]) cfg.options)


submit : String -> String -> Bool -> Html Msg
submit testId label_ isDisabled =
    button [ type_ "submit", class "rset-btn", attribute "data-testid" testId, disabled isDisabled ] [ text label_ ]


plainButton : String -> String -> Bool -> Msg -> Html Msg
plainButton testId label_ isDisabled msg =
    button [ type_ "button", class "rset-btn", attribute "data-testid" testId, disabled isDisabled, onClick msg ] [ text label_ ]


switch : { testId : String, label : String, hint : String, on : Bool, enabled : Bool, msg : Msg } -> Html Msg
switch cfg =
    button
        [ type_ "button"
        , attribute "role" "switch"
        , attribute "aria-checked" (boolAttr cfg.on)
        , attribute "data-testid" cfg.testId
        , classList [ ( "rset-toggle", True ), ( "rset-toggle-on", cfg.on ) ]
        , disabled (not cfg.enabled)
        , onClick cfg.msg
        ]
        [ span [ class "rset-toggle-track", attribute "aria-hidden" "true" ] [ span [ class "rset-toggle-thumb" ] [] ]
        , span [ class "rset-toggle-text" ]
            [ span [ class "rset-toggle-label" ] [ text cfg.label ]
            , span [ class "rset-hint" ] [ text cfg.hint ]
            ]
        ]


statusLine : Model -> String -> String -> Html Msg
statusLine model channel area =
    case Chanserv.statusOf channel area model.chanserv of
        Just notice ->
            p
                [ classList [ ( "rset-hint", True ), ( "rset-error", notice.tone == ToneError ), ( "cs-status", True ) ]
                , attribute "role"
                    (if notice.tone == ToneError then
                        "alert"

                     else
                        "status"
                    )
                , attribute "data-testid" ("chset-status-" ++ area)
                ]
                [ text notice.text ]

        Nothing ->
            text ""


boolAttr : Bool -> String
boolAttr b =
    if b then
        "true"

    else
        "false"


live : Model -> Bool
live model =
    model.connection == App.Live



-- WELCOME AND SLOW MODE


{-| Hosts edit the welcome message (`PROP ONJOIN`), the goodbye message
(`ONPART`, tucked away) and slow mode (`SLOWMODE` + `SLOWVOICE`).
Members see what is set, and nothing when nothing is.
-}
paceSection : Model -> RoomSettings.Ctx -> RoomSettings.Room -> Html Msg
paceSection model ctx room =
    let
        d =
            model.chanserv.drafts

        props =
            room.props

        gap =
            Chanserv.slowGapOf props

        welcome =
            Maybe.withDefault "" (Chanserv.propOf "ONJOIN" props)

        goodbye =
            Maybe.withDefault "" (Chanserv.propOf "ONPART" props)

        drafted =
            String.toLower d.channel == String.toLower room.name

        welcomeDraft =
            if drafted then
                d.welcome

            else
                welcome

        goodbyeDraft =
            if drafted then
                d.goodbye

            else
                goodbye

        slowDraft =
            if drafted then
                d.slow

            else
                String.fromInt gap

        slowVoiceDraft =
            if drafted then
                d.slowVoice

            else
                not (Chanserv.slowVoiceExempt props)

        slowOptions =
            Chanserv.slowPresets
                ++ (if List.any (\( s, _ ) -> s == gap) Chanserv.slowPresets then
                        []

                    else
                        [ ( gap, Chanserv.formatSeconds gap ) ]
                   )
                |> List.map (\( s, l ) -> ( String.fromInt s, l ))

        slowUnchanged =
            slowDraft == String.fromInt gap && slowVoiceDraft == not (Chanserv.slowVoiceExempt props)

        offline =
            not ctx.connected
    in
    if ctx.isOp then
        sectionWith "pace" "Welcome and slow mode" <|
            [ form [ class "rset-form", onSubmit (cs Chanserv.WelcomeSave) ]
                [ label [ class "rset-label", for "chset-welcome" ] [ text "Welcome message" ]
                , textarea
                    [ id "chset-welcome"
                    , class "rset-textarea"
                    , attribute "rows" "2"
                    , attribute "maxlength" (String.fromInt Chanserv.welcomeMax)
                    , attribute "aria-describedby" "chset-welcome-hint"
                    , attribute "data-testid" "chset-welcome"
                    , value welcomeDraft
                    , onInput (cs << Chanserv.WelcomeInput)
                    ]
                    []
                , p [ id "chset-welcome-hint", class "rset-hint" ] [ text "Sent privately to each person as they join. Leave it blank for none." ]
                , submit "chset-welcome-save" "Save welcome" (offline || String.trim welcomeDraft == welcome)
                ]
            , details [ class "cs-disclosure", attribute "data-testid" "chset-goodbye-disclosure" ]
                [ summary [] [ text "Goodbye message" ]
                , form [ class "rset-form", onSubmit (cs Chanserv.GoodbyeSave) ]
                    [ label [ class "rset-label", for "chset-goodbye" ] [ text "Goodbye message" ]
                    , input
                        [ id "chset-goodbye"
                        , class "rset-input"
                        , type_ "text"
                        , attribute "maxlength" (String.fromInt Chanserv.welcomeMax)
                        , attribute "aria-describedby" "chset-goodbye-hint"
                        , attribute "data-testid" "chset-goodbye"
                        , value goodbyeDraft
                        , onInput (cs << Chanserv.GoodbyeInput)
                        ]
                        []
                    , p [ id "chset-goodbye-hint", class "rset-hint" ] [ text "Sent privately to each person as they leave." ]
                    , submit "chset-goodbye-save" "Save goodbye" (offline || String.trim goodbyeDraft == goodbye)
                    ]
                ]
            , form [ class "rset-form cs-slow-form", onSubmit (cs Chanserv.SlowSave) ]
                [ label [ class "rset-label", for "chset-slow" ] [ text "Slow mode" ]
                , selectField
                    { id = "chset-slow"
                    , current = slowDraft
                    , options = slowOptions
                    , toMsg = cs << Chanserv.SlowInput
                    , describedBy = "chset-slow-hint"
                    , testId = "chset-slow"
                    }
                , p [ id "chset-slow-hint", class "rset-hint" ] [ text "How long each person waits between messages. Onyx Server enforces it." ]
                , switch
                    { testId = "chset-slow-voice"
                    , label = "Hosts and voiced people wait too"
                    , hint = "Off: hosts and voiced people can talk freely."
                    , on = slowVoiceDraft
                    , enabled = not offline
                    , msg = cs (Chanserv.SlowVoiceSet (not slowVoiceDraft))
                    }
                , submit "chset-slow-apply" "Apply slow mode" (offline || slowUnchanged)
                ]
            , statusLine model room.name "pace"
            ]

    else if gap > 0 || not (String.isEmpty welcome) then
        sectionWith "pace" "Welcome and slow mode" <|
            (if gap > 0 then
                [ readonly "chset-slow-readonly"
                    "Slow mode"
                    ("One message every " ++ String.toLower (Chanserv.formatSeconds gap))
                    (if Chanserv.slowExempt { props = props, selfModes = selfModes model room.name, isOper = model.isOper } then
                        "You're exempt."

                     else
                        "You'll wait this long between messages."
                    )
                ]

             else
                []
            )
                ++ (if String.isEmpty welcome then
                        []

                    else
                        [ readonly "chset-welcome-readonly" "Welcome message" welcome "" ]
                   )

    else
        text ""


selfModes : Model -> String -> List Char
selfModes model channel =
    Dict.get (String.toLower channel) model.channels
        |> Maybe.andThen (\ch -> Dict.get (String.toLower model.ourNick) ch.members)
        |> Maybe.map (.modes >> Set.toList)
        |> Maybe.withDefault []



-- MORE RULES (inside Room rules, hosts only)


{-| Every other channel rule as a plain-language switch, grouped, plus
the forward target, the join rate limit and a server-timed rule.
-}
moreRules : Model -> RoomSettings.Ctx -> RoomSettings.Room -> Html Msg
moreRules model ctx room =
    let
        flags =
            (Modes.parseChannelModeString room.modes).flags

        state =
            model.chanserv

        d =
            state.drafts

        offline =
            not ctx.connected

        group g =
            let
                rules =
                    List.filter (\r -> not r.operOnly || model.isOper) g.rules
            in
            if List.isEmpty rules then
                text ""

            else
                div [ class "cs-rule-group", attribute "role" "group", attribute "aria-labelledby" ("cs-rules-" ++ g.key) ]
                    [ h4 [ id ("cs-rules-" ++ g.key), class "cs-subhead" ] [ text g.title ]
                    , ul [ class "rset-flags" ]
                        (List.map
                            (\r ->
                                li [ class "rset-flag" ]
                                    [ switch
                                        { testId = "chset-rule-" ++ String.fromChar r.letter
                                        , label = r.label
                                        , hint = r.hint
                                        , on = List.member r.letter flags
                                        , enabled = not offline
                                        , msg = cs (Chanserv.RuleToggle r.letter)
                                        }
                                    ]
                            )
                            rules
                        )
                    ]

        forwardNow =
            Dict.get (String.toLower room.name) state.forwards

        throttleNow =
            Dict.get (String.toLower room.name) state.throttles

        timed =
            Chanserv.timedOf room.name state
    in
    details [ class "cs-disclosure", attribute "data-testid" "chset-more-rules" ]
        ([ summary [] [ text "More rules" ] ]
            ++ List.map group Chanserv.ruleGroups
            ++ [ form [ class "rset-form", onSubmit (cs Chanserv.ForwardSave) ]
                    [ label [ class "rset-label", for "chset-forward" ] [ text "Send people elsewhere when they can't join" ]
                    , input
                        [ id "chset-forward"
                        , class "rset-input"
                        , type_ "text"
                        , attribute "autocomplete" "off"
                        , attribute "placeholder" "#overflow"
                        , attribute "aria-describedby" "chset-forward-hint"
                        , attribute "data-testid" "chset-forward"
                        , value d.forward
                        , onInput (cs << Chanserv.ForwardInput)
                        ]
                        []
                    , p [ id "chset-forward-hint", class "rset-hint" ]
                        [ text
                            (case forwardNow of
                                Just target ->
                                    "Now: " ++ target ++ ". You must be a host in the other room too."

                                Nothing ->
                                    "When this room is full or locked, joins go to the room you name. You must be a host there too."
                            )
                        ]
                    , div [ class "rset-actions" ]
                        [ submit "chset-forward-save" "Set forwarding" offline
                        , plainButton "chset-forward-clear" "Turn off" offline (cs Chanserv.ForwardClear)
                        ]
                    ]
               , form [ class "rset-form", onSubmit (cs Chanserv.ThrottleSave) ]
                    [ span [ class "rset-label", id "chset-throttle-label" ] [ text "Join rate limit" ]
                    , div [ class "cs-pair", attribute "role" "group", attribute "aria-labelledby" "chset-throttle-label" ]
                        [ input
                            [ class "rset-input"
                            , type_ "number"
                            , attribute "min" "1"
                            , attribute "inputmode" "numeric"
                            , attribute "aria-label" "Joins"
                            , attribute "data-testid" "chset-throttle-joins"
                            , value d.throttleJoins
                            , onInput (cs << Chanserv.ThrottleJoinsInput)
                            ]
                            []
                        , span [ class "cs-pair-word" ] [ text "joins per" ]
                        , input
                            [ class "rset-input"
                            , type_ "number"
                            , attribute "min" "1"
                            , attribute "inputmode" "numeric"
                            , attribute "aria-label" "Seconds"
                            , attribute "data-testid" "chset-throttle-secs"
                            , value d.throttleSecs
                            , onInput (cs << Chanserv.ThrottleSecsInput)
                            ]
                            []
                        , span [ class "cs-pair-word" ] [ text "seconds" ]
                        ]
                    , p [ class "rset-hint" ]
                        [ text
                            (case throttleNow of
                                Just spec ->
                                    "Now: " ++ String.replace ":" " joins per " spec ++ " seconds. Extra joins are turned away for a moment."

                                Nothing ->
                                    "Slows a flood of arrivals. Extra joins are turned away for a moment."
                            )
                        ]
                    , div [ class "rset-actions" ]
                        [ submit "chset-throttle-save" "Set limit" offline
                        , plainButton "chset-throttle-clear" "Turn off" offline (cs Chanserv.ThrottleClear)
                        ]
                    ]
               , form [ class "rset-form", onSubmit (cs Chanserv.TimedStart) ]
                    [ span [ class "rset-label", id "chset-timed-label" ] [ text "Turn a rule on for a while" ]
                    , div [ class "cs-pair", attribute "role" "group", attribute "aria-labelledby" "chset-timed-label" ]
                        [ select
                            [ class "rset-select"
                            , attribute "aria-label" "Rule"
                            , attribute "data-testid" "chset-timed-rule"
                            , value d.timedLetter
                            , changeTo (cs << Chanserv.TimedLetterInput)
                            ]
                            (List.map (\( l, name ) -> option [ value (String.fromChar l), selected (String.fromChar l == d.timedLetter) ] [ text name ]) Chanserv.timedLetters)
                        , select
                            [ class "rset-select"
                            , attribute "aria-label" "For how long"
                            , attribute "data-testid" "chset-timed-minutes"
                            , value d.timedMinutes
                            , changeTo (cs << Chanserv.TimedMinutesInput)
                            ]
                            (List.map (\( m, name ) -> option [ value (String.fromInt m), selected (String.fromInt m == d.timedMinutes) ] [ text name ]) Chanserv.timedDurations)
                        ]
                    , p [ class "rset-hint" ] [ text "Onyx Server switches it back off on time, even if you close Onyx." ]
                    , submit "chset-timed-start" "Turn on" offline
                    ]
               ]
            ++ (if List.isEmpty timed then
                    []

                else
                    [ ul [ class "rset-access-list", attribute "aria-label" "Timed rules" ]
                        (List.map
                            (\r ->
                                li [ class "rset-access-row cs-row" ]
                                    [ div [ class "rset-access-meta" ]
                                        [ span [ class "rset-access-level" ] [ text (timedName r.letter) ]
                                        , span [ class "rset-hint" ] [ text ("Until " ++ clock model r.until) ]
                                        ]
                                    , plainButton ("chset-timed-end-" ++ String.fromChar r.letter) "End now" offline (cs (Chanserv.TimedEnd r.letter))
                                    ]
                            )
                            timed
                        )
                    ]
               )
            ++ [ statusLine model room.name "rules" ]
        )


timedName : Char -> String
timedName letter =
    Chanserv.timedLetters
        |> List.filter (\( l, _ ) -> l == letter)
        |> List.head
        |> Maybe.map Tuple.second
        |> Maybe.withDefault "Rule"


clock : Model -> Float -> String
clock model ms =
    let
        posix =
            Time.millisToPosix (round ms)

        pad n =
            String.padLeft 2 '0' (String.fromInt n)
    in
    pad (Time.toHour model.zone posix) ++ ":" ++ pad (Time.toMinute model.zone posix)



-- REGISTRATION


{-| `CHANNEL REGISTER/INFO/SET/ACCESS/AKICK/DROP`, `SUCCESSOR` and
`LISTCHANS`. Hosts see how to register; members see only a registered
room's founder and description; the founder gets the editors, each
heavy list in its own disclosure.
-}
registrationSection : Model -> RoomSettings.Ctx -> RoomSettings.Room -> Html Msg
registrationSection model ctx room =
    let
        channel =
            room.name

        state =
            model.chanserv
    in
    case Chanserv.registrationOf channel state of
        Registered info ->
            registeredBody model ctx room info

        reg ->
            if not ctx.isOp then
                text ""

            else
                sectionWith "registration" "Registration" <|
                    (case ( model.accountName, reg ) of
                        ( Nothing, _ ) ->
                            [ p [ class "rset-hint", attribute "data-testid" "chset-reg-signin" ]
                                [ text "Sign in to your Onyx account to register this room. A registered room keeps its founder, locked rules and access list when everyone leaves." ]
                            ]

                        ( _, RegSignedOut ) ->
                            [ p [ class "rset-hint", attribute "data-testid" "chset-reg-signin" ]
                                [ text "Sign in to your Onyx account to register this room." ]
                            ]

                        ( Just account, RegNone ) ->
                            [ readonly "chset-reg-none" "Status" "Not registered" ("Registering ties this room to your account, " ++ account ++ ". You become its founder: its locked rules, access list and auto-kick list outlast an empty room.")
                            , div [ class "rset-actions" ]
                                [ button
                                    [ type_ "button"
                                    , class "rset-btn rset-btn-primary"
                                    , attribute "data-testid" "chset-register"
                                    , disabled (not ctx.connected)
                                    , onClick (cs Chanserv.Register)
                                    ]
                                    [ text "Register this room" ]
                                ]
                            ]

                        _ ->
                            [ p [ class "rset-hint", attribute "role" "status", attribute "data-testid" "chset-reg-checking" ] [ text "Checking registration…" ]
                            , plainButton "chset-reg-refresh" "Check again" (not ctx.connected) (cs Chanserv.Refresh)
                            ]
                    )
                        ++ [ statusLine model channel "reg" ]


registeredBody : Model -> RoomSettings.Ctx -> RoomSettings.Room -> Chanserv.RegInfo -> Html Msg
registeredBody model ctx room info =
    let
        channel =
            room.name

        state =
            model.chanserv

        manage =
            Chanserv.canManage model.accountName channel state

        you =
            if Chanserv.isFounder model.accountName info then
                " (you)"

            else
                ""

        summaryRows =
            [ readonly "chset-reg-founder" "Registered to" (info.founder ++ you) "" ]
                ++ (if manage || String.isEmpty info.desc then
                        []

                    else
                        [ readonly "chset-reg-desc" "Description" info.desc "" ]
                   )
                ++ (if manage || String.isEmpty info.url then
                        []

                    else
                        [ readonly "chset-reg-url" "Website" info.url "" ]
                   )
    in
    sectionWith "registration" "Registration" <|
        summaryRows
            ++ (if manage then
                    founderTools model ctx room info

                else if ctx.isOp then
                    [ p [ class "rset-hint" ] [ text ("Only " ++ info.founder ++ " can change the registration.") ] ]

                else
                    []
               )
            ++ [ statusLine model channel "reg" ]


founderTools : Model -> RoomSettings.Ctx -> RoomSettings.Room -> Chanserv.RegInfo -> List (Html Msg)
founderTools model ctx room info =
    let
        channel =
            room.name

        state =
            model.chanserv

        d =
            state.drafts

        offline =
            not ctx.connected

        keepTopic =
            Maybe.withDefault False (Dict.get (String.toLower channel) state.keepTopic)

        mlockSelect ( letter, name ) =
            let
                current =
                    Maybe.withDefault "" (Dict.get letter d.mlock)

                fieldId =
                    "chset-mlock-" ++ String.fromChar letter
            in
            li [ class "cs-mlock-row" ]
                [ label [ class "cs-mlock-name", for fieldId ] [ text name ]
                , select
                    [ id fieldId
                    , class "rset-select"
                    , attribute "data-testid" fieldId
                    , changeTo (cs << Chanserv.MlockPick letter)
                    ]
                    (List.map
                        (\( v, l ) -> option [ value v, selected (v == current) ] [ text l ])
                        [ ( "", "Hosts decide" ), ( "on", "Always on" ), ( "off", "Always off" ) ]
                    )
                ]

        access =
            Chanserv.accessOf channel state

        akick =
            Chanserv.akickOf channel state

        successor =
            Chanserv.successorOf channel state

    in
    [ form [ class "rset-form", onSubmit (cs Chanserv.DescSave) ]
        [ label [ class "rset-label", for "chset-desc" ] [ text "Description" ]
        , input [ id "chset-desc", class "rset-input", type_ "text", attribute "maxlength" "400", attribute "data-testid" "chset-desc", value d.desc, onInput (cs << Chanserv.DescInput) ] []
        , submit "chset-desc-save" "Save description" (offline || String.isEmpty (String.trim d.desc) || String.trim d.desc == info.desc)
        ]
    , form [ class "rset-form", onSubmit (cs Chanserv.UrlSave) ]
        [ label [ class "rset-label", for "chset-url" ] [ text "Website" ]
        , input [ id "chset-url", class "rset-input", type_ "url", attribute "inputmode" "url", attribute "placeholder" "https://", attribute "data-testid" "chset-url", value d.url, onInput (cs << Chanserv.UrlInput) ] []
        , submit "chset-url-save" "Save website" (offline || String.isEmpty (String.trim d.url) || String.trim d.url == info.url)
        ]
    , details [ class "cs-disclosure", attribute "data-testid" "chset-protect" ]
        [ summary [] [ text "Protection and locked rules" ]
        , ul [ class "rset-flags" ]
            [ li [] [ switch { testId = "chset-guard", label = "Keep the room open when empty", hint = "Onyx Server holds the room so its rules and topic stay while nobody is here.", on = info.guard, enabled = not offline, msg = cs (Chanserv.FlagSet "GUARD" (not info.guard)) } ]
            , li [] [ switch { testId = "chset-topiclock", label = "Lock the topic", hint = "Only hosts can change the topic, even after the room empties.", on = info.topiclock, enabled = not offline, msg = cs (Chanserv.FlagSet "TOPICLOCK" (not info.topiclock)) } ]
            , li [] [ switch { testId = "chset-keeptopic", label = "Remember the topic", hint = "Brings the topic back when the room is recreated.", on = keepTopic, enabled = not offline, msg = cs (Chanserv.KeepTopicSet (not keepTopic)) } ]
            , li [] [ switch { testId = "chset-private", label = "Hide from room lists", hint = "Keeps the room out of public listings. Turns on Secret now.", on = info.private, enabled = not offline, msg = cs (Chanserv.FlagSet "PRIVATE" (not info.private)) } ]
            ]
        , form [ class "rset-form", onSubmit (cs Chanserv.MlockSave) ]
            [ span [ class "rset-label" ] [ text "Locked rules" ]
            , p [ class "rset-hint" ] [ text "Locked rules stay the way you set them. Other hosts can't change them." ]
            , ul [ class "cs-mlock" ] (List.map mlockSelect Chanserv.mlockLetters)
            , submit "chset-mlock-save" "Save locked rules" (offline || Chanserv.buildMlock d.mlock == Nothing || Chanserv.buildMlock d.mlock == Just info.mlock)
            ]
        ]
    , details [ class "cs-disclosure", attribute "data-testid" "chset-account-access", onOpen (cs Chanserv.AccessLoad) ]
        ([ summary [] [ text "Account access" ]
         , p [ class "rset-hint" ] [ text "Onyx accounts that get a role here whenever they join, on any device." ]
         ]
            ++ listBlock
                { loading = access.loading
                , empty = "No accounts have access yet."
                , label = "Account access"
                , rows =
                    List.map
                        (\e ->
                            ( [ span [ class "rset-access-level" ] [ text (levelLabel e.level) ]
                              , span [ class "rset-mono" ] [ text e.account ]
                              ]
                            , if String.toUpper e.level == "FOUNDER" && String.toLower e.account == String.toLower info.founder then
                                text ""

                              else
                                button
                                    [ type_ "button"
                                    , class "rset-btn"
                                    , disabled offline
                                    , attribute "aria-label" ("Remove access for " ++ e.account)
                                    , onClick (cs (Chanserv.AccessDel e.account e.level))
                                    ]
                                    [ text "Remove" ]
                            )
                        )
                        access.entries
                }
            ++ [ form [ class "rset-form", onSubmit (cs Chanserv.AccessAdd) ]
                    [ label [ class "rset-label", for "chset-cs-access-account" ] [ text "Account" ]
                    , input [ id "chset-cs-access-account", class "rset-input", type_ "text", attribute "autocomplete" "off", attribute "data-testid" "chset-cs-access-account", value d.accessAccount, onInput (cs << Chanserv.AccessAccountInput) ] []
                    , label [ class "rset-label", for "chset-cs-access-level" ] [ text "Role" ]
                    , selectField
                        { id = "chset-cs-access-level"
                        , current = d.accessLevel
                        , options = Chanserv.accessLevels
                        , toMsg = cs << Chanserv.AccessLevelInput
                        , describedBy = "chset-cs-access-hint"
                        , testId = "chset-cs-access-level"
                        }
                    , p [ id "chset-cs-access-hint", class "rset-hint" ] [ text "Founders can manage the registration too." ]
                    , submit "chset-cs-access-add" "Give access" (offline || String.isEmpty (String.trim d.accessAccount))
                    ]
               , statusLine model channel "access"
               ]
        )
    , details [ class "cs-disclosure", attribute "data-testid" "chset-akick", onOpen (cs Chanserv.AkickLoad) ]
        ([ summary [] [ text "Auto-kick" ]
         , p [ class "rset-hint" ] [ text "People matching these stay out, even after the room empties and comes back." ]
         ]
            ++ listBlock
                { loading = akick.loading
                , empty = "No one is on the auto-kick list."
                , label = "Auto-kick list"
                , rows =
                    List.map
                        (\e ->
                            ( [ span [ class "rset-mono" ] [ text e.mask ]
                              , if String.isEmpty e.reason then
                                    text ""

                                else
                                    span [ class "rset-hint" ] [ text e.reason ]
                              ]
                            , button
                                [ type_ "button"
                                , class "rset-btn"
                                , disabled offline
                                , attribute "aria-label" ("Remove " ++ e.mask ++ " from auto-kick")
                                , onClick (cs (Chanserv.AkickDel e.mask))
                                ]
                                [ text "Remove" ]
                            )
                        )
                        akick.entries
                }
            ++ [ form [ class "rset-form", onSubmit (cs Chanserv.AkickAdd) ]
                    [ label [ class "rset-label", for "chset-akick-mask" ] [ text "Name or mask" ]
                    , input [ id "chset-akick-mask", class "rset-input", type_ "text", attribute "autocomplete" "off", attribute "aria-describedby" "chset-akick-hint", attribute "data-testid" "chset-akick-mask", value d.akickMask, onInput (cs << Chanserv.AkickMaskInput) ] []
                    , p [ id "chset-akick-hint", class "rset-hint" ] [ text "A name becomes name!*@*. Use account:name for an Onyx account." ]
                    , label [ class "rset-label", for "chset-akick-reason" ] [ text "Reason (optional)" ]
                    , input [ id "chset-akick-reason", class "rset-input", type_ "text", attribute "maxlength" "200", attribute "data-testid" "chset-akick-reason", value d.akickReason, onInput (cs << Chanserv.AkickReasonInput) ] []
                    , submit "chset-akick-add" "Add to auto-kick" (offline || String.isEmpty (String.trim d.akickMask))
                    ]
               , statusLine model channel "akick"
               ]
        )
    , details [ class "cs-disclosure", attribute "data-testid" "chset-successor", onOpen (cs Chanserv.SuccessorLoad) ]
        [ summary [] [ text "Successor" ]
        , p [ class "rset-hint" ]
            [ text
                (case successor of
                    Just (Just account) ->
                        account ++ " takes over if the founder's account is dropped."

                    Just Nothing ->
                        "No successor. If the founder's account is dropped, the room loses its founder."

                    Nothing ->
                        "Who takes over if the founder's account is dropped."
                )
            ]
        , form [ class "rset-form", onSubmit (cs Chanserv.SuccessorSet) ]
            [ label [ class "rset-label", for "chset-successor" ] [ text "Successor account" ]
            , input [ id "chset-successor", class "rset-input", type_ "text", attribute "autocomplete" "off", attribute "data-testid" "chset-successor-input", value d.successor, onInput (cs << Chanserv.SuccessorInput) ] []
            , div [ class "rset-actions" ]
                [ submit "chset-successor-set" "Set successor" (offline || String.isEmpty (String.trim d.successor))
                , case successor of
                    Just (Just _) ->
                        plainButton "chset-successor-clear" "Clear" offline (cs Chanserv.SuccessorClear)

                    _ ->
                        text ""
                ]
            ]
        , statusLine model channel "successor"
        ]
    , if state.confirmDrop then
        div [ class "cs-confirm", attribute "role" "group", attribute "aria-label" "Drop registration" ]
            [ p [ class "rset-hint" ] [ text ("Drop the registration for " ++ channel ++ "? The room stays open, but its founder, locked rules, access list and auto-kick list are gone.") ]
            , div [ class "rset-actions" ]
                [ button [ type_ "button", class "rset-btn cs-btn-danger", attribute "data-testid" "chset-drop-confirm", disabled offline, onClick (cs Chanserv.DropConfirm) ] [ text "Drop registration" ]
                , plainButton "chset-drop-cancel" "Keep it" False (cs Chanserv.DropCancel)
                ]
            ]

      else
        div [ class "rset-actions" ] [ plainButton "chset-drop" "Drop registration…" offline (cs Chanserv.DropAsk) ]
    ]


levelLabel : String -> String
levelLabel level =
    case String.toUpper level of
        "OP" ->
            "Host"

        "VOICE" ->
            "Voice"

        "FOUNDER" ->
            "Founder"

        "ADMIN" ->
            "Admin"

        other ->
            other


listBlock : { loading : Bool, empty : String, label : String, rows : List ( List (Html Msg), Html Msg ) } -> List (Html Msg)
listBlock cfg =
    if List.isEmpty cfg.rows then
        [ p [ class "rset-hint", attribute "role" "status" ]
            [ text
                (if cfg.loading then
                    "Loading…"

                 else
                    cfg.empty
                )
            ]
        ]

    else
        [ ul [ class "rset-access-list", attribute "aria-label" cfg.label, attribute "aria-busy" (boolAttr cfg.loading) ]
            (List.map
                (\( meta, action ) ->
                    li [ class "rset-access-row cs-row" ]
                        [ div [ class "rset-access-meta" ] meta
                        , action
                        ]
                )
                cfg.rows
            )
        ]



-- YOUR ROOMS (Account sheet)


{-| "Your rooms": the registered rooms this account has a role in
(`LISTCHANS`), mounted in the Account sheet with that sheet's own
section classes. Asks only when the person asks.
-}
myRoomsSection : Model -> Html Msg
myRoomsSection model =
    let
        mine =
            model.chanserv.myRooms
    in
    section
        [ class "onyx-account-section cs-my-rooms"
        , id "acct-rooms"
        , attribute "aria-labelledby" "acct-rooms-title"
        , attribute "data-testid" "account-rooms"
        ]
        ([ h3 [ class "onyx-account-section__title", id "acct-rooms-title" ] [ text "Your rooms" ]
         , p [ class "onyx-account-hint" ] [ text "Registered rooms where your account is a founder, host or voice." ]
         , div [ class "onyx-account-actions" ]
            [ button
                [ type_ "button"
                , class "onyx-button"
                , attribute "data-testid" "account-rooms-load"
                , disabled (not (live model) || mine.loading)
                , onClick (cs Chanserv.MyRoomsLoad)
                ]
                [ text
                    (if mine.loaded then
                        "Refresh"

                     else
                        "Show my rooms"
                    )
                ]
            ]
         ]
            ++ (if mine.loading then
                    [ p [ class "onyx-account-hint", attribute "role" "status" ] [ text "Loading…" ] ]

                else if List.isEmpty mine.rooms then
                    if mine.loaded then
                        [ p [ class "onyx-account-empty", attribute "data-testid" "account-rooms-empty" ] [ text "None yet. Open a room's settings to register it." ] ]

                    else
                        []

                else
                    [ ul [ class "cs-my-rooms-list", attribute "aria-label" "Your registered rooms" ]
                        (List.map
                            (\r ->
                                li [ class "cs-my-room", attribute "data-testid" "account-room" ]
                                    [ span [ class "cs-my-room-name" ] [ text r.channel ]
                                    , span [ class "rset-hint" ] [ text (levelLabel r.level) ]
                                    ]
                            )
                            mine.rooms
                        )
                    ]
               )
        )



-- MUTES AND EXCEPTIONS (+Z / +e / +I)


listsSection : Model -> RoomSettings.Ctx -> RoomSettings.Room -> Html Msg
listsSection model ctx room =
    if not ctx.isOp then
        text ""

    else
        let
            state =
                model.chanserv

            tab =
                state.listTab

            kind =
                Chanserv.listKinds
                    |> List.filter (\k -> k.letter == tab)
                    |> List.head
                    |> Maybe.withDefault { letter = 'Z', tab = "Muted", name = "Muted people", hint = "", add = "Mute", empty = "" }

            current =
                Chanserv.listOf room.name tab state

            offline =
                not ctx.connected

            tabId letter =
                "chset-list-tab-" ++ String.fromChar letter
        in
        sectionWith "lists" "Mutes and exceptions" <|
            [ div [ class "cs-tabs", attribute "role" "tablist", attribute "aria-label" "Mask lists" ]
                (List.map
                    (\k ->
                        button
                            [ type_ "button"
                            , class "cs-tab"
                            , id (tabId k.letter)
                            , attribute "role" "tab"
                            , attribute "aria-selected" (boolAttr (k.letter == tab))
                            , attribute "aria-controls" "chset-list-panel"
                            , attribute "aria-label" k.name
                            , attribute "data-testid" (tabId k.letter)
                            , onClick (cs (Chanserv.ListTab k.letter))
                            ]
                            [ text k.tab ]
                    )
                    Chanserv.listKinds
                )
            , div [ class "cs-tabpanel", id "chset-list-panel", attribute "role" "tabpanel", attribute "aria-labelledby" (tabId tab) ]
                ([ p [ class "rset-hint" ] [ text kind.hint ] ]
                    ++ listBlock
                        { loading = current.loading
                        , empty =
                            if current.loaded then
                                kind.empty

                            else
                                "Not loaded yet."
                        , label = kind.name
                        , rows =
                            List.map
                                (\e ->
                                    ( [ span [ class "rset-mono" ] [ text e.mask ]
                                      , if String.isEmpty e.setBy then
                                            text ""

                                        else
                                            span [ class "rset-hint" ] [ text ("Set by " ++ nickOf e.setBy) ]
                                      ]
                                    , button
                                        [ type_ "button"
                                        , class "rset-btn"
                                        , disabled offline
                                        , attribute "aria-label" ("Remove " ++ e.mask)
                                        , onClick (cs (Chanserv.ListDel tab e.mask))
                                        ]
                                        [ text "Remove" ]
                                    )
                                )
                                current.entries
                        }
                    ++ [ form [ class "rset-form", onSubmit (cs Chanserv.ListAdd) ]
                            [ label [ class "rset-label", for "chset-list-mask" ] [ text "Name or mask" ]
                            , input
                                [ id "chset-list-mask"
                                , class "rset-input"
                                , type_ "text"
                                , attribute "autocomplete" "off"
                                , attribute "aria-describedby" "chset-list-mask-hint"
                                , attribute "data-testid" "chset-list-mask"
                                , value state.drafts.listMask
                                , onInput (cs << Chanserv.ListMaskInput)
                                ]
                                []
                            , p [ id "chset-list-mask-hint", class "rset-hint" ] [ text "A name becomes name!*@*. Full masks use name!user@host." ]
                            , div [ class "rset-actions" ]
                                [ submit "chset-list-add" kind.add (offline || String.isEmpty (String.trim state.drafts.listMask))
                                , plainButton "chset-list-refresh" "Refresh" (offline || current.loading) (cs (Chanserv.ListLoad tab))
                                ]
                            ]
                       , statusLine model room.name "lists"
                       ]
                )
            ]


nickOf : String -> String
nickOf setter =
    case String.indexes "!" setter of
        at :: _ ->
            String.left at setter

        [] ->
            setter



-- JOIN PROMPT (refusal card + Ask to join)


{-| The app-wide card for a refused join (the browser shows its own
line and actions while it is open).
-}
joinPromptCard : Model -> Html Msg
joinPromptCard model =
    case ( model.channelJoinPrompt, model.browserOpen ) of
        ( Just prompt, False ) ->
            let
                code =
                    Maybe.withDefault "" (Dict.get (String.toLower prompt.channel) model.chanserv.refusal)

                ( title, body ) =
                    Chanserv.joinRefusalCopy code prompt.channel prompt.error
            in
            div
                [ class "cs-join"
                , attribute "role" "region"
                , attribute "aria-labelledby" "cs-join-title"
                , attribute "data-testid" "join-prompt"
                ]
                [ div [ class "cs-join-copy" ]
                    [ p [ class "cs-join-title", id "cs-join-title" ] [ text title ]
                    , p [ class "cs-join-body", attribute "role" "status" ] [ text body ]
                    ]
                , promptActions model prompt.channel code
                , button
                    [ type_ "button"
                    , class "cs-join-close"
                    , attribute "aria-label" "Dismiss"
                    , attribute "data-testid" "join-prompt-dismiss"
                    , onClick (cs (Chanserv.DismissPrompt prompt.channel))
                    ]
                    [ span [ class "onyx-sheet-x", attribute "aria-hidden" "true" ] [] ]
                ]

        _ ->
            text ""


{-| Ask to join / key entry under the room browser's refusal line. -}
joinPromptActions : Model -> Html Msg
joinPromptActions model =
    case model.channelJoinPrompt of
        Just prompt ->
            promptActions model prompt.channel (Maybe.withDefault "" (Dict.get (String.toLower prompt.channel) model.chanserv.refusal))

        Nothing ->
            text ""


promptActions : Model -> String -> String -> Html Msg
promptActions model channel code =
    let
        offline =
            not (live model)

        knock =
            Chanserv.knockStateOf channel model.chanserv

        canKnock =
            List.member code [ "471", "473", "475" ]

        d =
            model.chanserv.drafts

        keyForm =
            if code == "475" then
                [ form [ class "cs-join-key", onSubmit (cs (Chanserv.JoinWithKey channel)) ]
                    [ input
                        [ class "rset-input"
                        , type_ "password"
                        , attribute "autocomplete" "off"
                        , attribute "aria-label" ("Key for " ++ channel)
                        , attribute "placeholder" "Room key"
                        , attribute "data-testid" "join-prompt-key"
                        , value d.joinKey
                        , onInput (cs << Chanserv.JoinKeyInput)
                        ]
                        []
                    , button [ type_ "submit", class "rset-btn rset-btn-primary", attribute "data-testid" "join-prompt-key-join", disabled (offline || String.isEmpty (String.trim d.joinKey)) ] [ text "Join" ]
                    ]
                ]

            else
                []

        knockPart =
            if not canKnock then
                []

            else
                case knock of
                    Just (Chanserv.KnockSending _) ->
                        [ p [ class "rset-hint", attribute "role" "status" ] [ text "Asking the hosts…" ] ]

                    Just Chanserv.KnockDelivered ->
                        [ p [ class "rset-hint", attribute "role" "status", attribute "data-testid" "join-prompt-knocked" ] [ text "Request sent. A host can invite you in." ] ]

                    Just Chanserv.KnockNoHosts ->
                        [ p [ class "rset-hint", attribute "role" "status", attribute "data-testid" "join-prompt-nohosts" ] [ text "No hosts are around to see it right now. Try again later." ] ]

                    Just Chanserv.KnockRefused ->
                        [ p [ class "rset-hint", attribute "role" "status" ] [ text "This room doesn't take join requests. Ask someone inside for an invite." ] ]

                    Nothing ->
                        [ form [ class "cs-join-ask", onSubmit (cs (Chanserv.AskToJoin channel)) ]
                            [ input
                                [ class "rset-input"
                                , type_ "text"
                                , attribute "maxlength" "200"
                                , attribute "aria-label" "Note to the hosts (optional)"
                                , attribute "placeholder" "Note to the hosts (optional)"
                                , attribute "data-testid" "join-prompt-note"
                                , value d.knockNote
                                , onInput (cs << Chanserv.KnockNoteInput)
                                ]
                                []
                            , button
                                [ type_ "submit"
                                , class
                                    (if code == "475" then
                                        "rset-btn"

                                     else
                                        "rset-btn rset-btn-primary"
                                    )
                                , attribute "data-testid" "join-prompt-knock"
                                , disabled offline
                                ]
                                [ text "Ask to join" ]
                            ]
                        ]

        retry =
            if code == "480" || code == "471" then
                [ button [ type_ "button", class "rset-btn", attribute "data-testid" "join-prompt-retry", disabled offline, onClick (BrowserEnterRoom channel) ] [ text "Try again" ] ]

            else
                []
    in
    if List.isEmpty (keyForm ++ knockPart ++ retry) then
        text ""

    else
        div [ class "cs-join-actions" ] (keyForm ++ knockPart ++ retry)



-- KNOCKS (hosts' inbox)


{-| The Invite action on an inbox row that says "X asks to join #c"
(710). The row itself is an ordinary notification; this adds the one
thing a host needs, and says "Invited" once it has been used.
-}
knockAction : Model -> App.InboxNotification -> Html Msg
knockAction model note =
    case ( note.kind, note.from, note.channel ) of
        ( NotifSystem, Just nick, Just channel ) ->
            case
                List.filter
                    (\k -> String.toLower k.nick == String.toLower nick && String.toLower k.channel == String.toLower channel)
                    model.chanserv.knocks
            of
                k :: _ ->
                    div [ class "cs-knock-actions" ]
                        [ if k.invited then
                            span [ class "rset-hint", attribute "role" "status", attribute "data-testid" "knock-invited" ] [ text "Invited" ]

                          else
                            button
                                [ type_ "button"
                                , class "rset-btn rset-btn-primary"
                                , attribute "data-testid" "knock-invite"
                                , attribute "aria-label" ("Invite " ++ k.nick ++ " to " ++ k.channel)
                                , disabled (not (live model) || not (App.isChannelOp model k.channel))
                                , onClick (cs (Chanserv.InviteKnock k.id))
                                ]
                                [ text "Invite" ]
                        , if k.reason == "" || k.reason == "wants to join" then
                            text ""

                          else
                            span [ class "rset-hint cs-knock-note" ] [ text ("\u{201C}" ++ k.reason ++ "\u{201D}") ]
                        ]

                [] ->
                    text ""

        _ ->
            text ""



-- COMPOSER (slow mode)


slowState : Model -> Maybe { gap : Int, wait : Int }
slowState model =
    case model.activeChannel of
        Just target ->
            if App.isChannelName model target then
                let
                    props =
                        Maybe.withDefault Dict.empty (Dict.get (String.toLower target) model.props.channelProps)

                    gap =
                        Chanserv.slowGapOf props

                    exempt =
                        Chanserv.slowExempt { props = props, selfModes = selfModes model target, isOper = model.isOper }
                in
                if gap <= 0 || exempt then
                    Nothing

                else
                    Just
                        { gap = gap
                        , wait =
                            Chanserv.slowWait
                                { props = props, selfModes = selfModes model target, isOper = model.isOper, nowMs = model.nowMs }
                                target
                                model.chanserv
                        }

            else
                Nothing

        Nothing ->
            Nothing


composerSlowWaiting : Model -> Bool
composerSlowWaiting model =
    case slowState model of
        Just s ->
            s.wait > 0

        Nothing ->
            False


{-| One quiet line over the composer while slow mode applies to you. -}
slowNote : Model -> Html Msg
slowNote model =
    case slowState model of
        Just s ->
            p
                [ classList [ ( "cs-slow", True ), ( "cs-slow-wait", s.wait > 0 ) ]
                , attribute "data-testid" "composer-slowmode"
                ]
                [ span [ class "cs-slow-dot", attribute "aria-hidden" "true" ] []
                , text
                    (if s.wait > 0 then
                        "Slow mode · send again in " ++ String.fromInt ((s.wait + 999) // 1000) ++ "s"

                     else
                        "Slow mode · one message every " ++ String.toLower (Chanserv.formatSeconds s.gap)
                    )
                ]

        Nothing ->
            text ""



-- MEMBER CARD


{-| Mute (`+Z nick!*@*`) next to Kick / Ban. Flips to Unmute when the
quiet list names the person.
-}
muteButton : Model -> String -> String -> Html Msg
muteButton model channel nick =
    if not (App.isChannelOp model channel) || String.toLower nick == String.toLower model.ourNick then
        text ""

    else
        let
            muted =
                (Chanserv.listOf channel 'Z' model.chanserv).entries
                    |> List.any (\e -> String.toLower (nickOf e.mask) == String.toLower nick)
        in
        button
            [ attribute "type" "button"
            , class "onyx-member-action"
            , attribute "data-testid" "member-mute"
            , attribute "aria-label"
                ((if muted then
                    "Unmute "

                  else
                    "Mute "
                 )
                    ++ nick
                    ++ " in "
                    ++ channel
                )
            , disabled (not (live model))
            , onClick
                (cs
                    (if muted then
                        Chanserv.UnmuteMember channel nick

                     else
                        Chanserv.MuteMember channel nick
                    )
                )
            ]
            [ text
                (if muted then
                    "Unmute"

                 else
                    "Mute"
                )
            ]
