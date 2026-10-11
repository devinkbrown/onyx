module View.OperTabs exposing
    ( abuseTab
    , appealsTab
    , bansTab
    , contentTab
    , pendingFor
    , silenceTab
    )

{-| v3/gap-oper — the network tabs of the operator desk (Bans, Silence,
Abuse, Appeals, Content). Each tab is the same shape: one line saying
what the tab is for, a small form per job, the daemon's list below it,
and the replies it sent back. Anything that changes the network goes
through the review block first.
-}

import App exposing (ConnectionState(..), Model, Msg(..))
import Html exposing (Html, button, details, div, dd, dl, dt, form, li, p, span, strong, summary, text, textarea, ul)
import Html.Attributes exposing (attribute, class, disabled, id, maxlength, placeholder, rows, type_, value)
import Html.Events exposing (onClick, onInput, onSubmit)
import OperConsole as C exposing (Field(..))
import OperPlan exposing (BanKind(..), Intent(..))
import OperReply exposing (Section(..))
import View.OperKit as K


live : Model -> Bool
live model =
    model.connection == Live


{-| The staged command, shown inside the tab that staged it. -}
pendingFor : Model -> Section -> List (Html Msg)
pendingFor model section =
    let
        console =
            model.operConsole
    in
    (case console.pending of
        Just command ->
            if command.section == section then
                [ K.reviewBlock (live model) command ]

            else
                []

        Nothing ->
            []
    )
        ++ (case console.errors of
                [] ->
                    []

                errors ->
                    [ ul [ class "oc-errors", attribute "role" "alert", attribute "data-testid" "oc-errors" ]
                        (List.map (\e -> li [] [ text e ]) errors)
                    ]
           )


edit : Field -> String -> Msg
edit field value =
    K.consoleMsg (C.Edit field value)


run : Intent -> Msg
run intent =
    K.consoleMsg (C.Run intent)


refresh : Section -> Msg
refresh section =
    K.consoleMsg (C.Refresh section)



-- BANS


facetOptions : List ( String, String )
facetOptions =
    [ ( "mask", "Mask (nick!user@host)" )
    , ( "address", "IP address or range" )
    , ( "host", "Host name" )
    , ( "account", "Account" )
    , ( "realname", "Real name" )
    , ( "certfp", "Certificate fingerprint" )
    , ( "country", "Country code" )
    , ( "asn", "Network (ASN)" )
    ]


facetName : String -> String
facetName facet =
    facetOptions
        |> List.filter (\( v, _ ) -> v == facet)
        |> List.head
        |> Maybe.map Tuple.second
        |> Maybe.withDefault facet


actionOptions : List ( String, String )
actionOptions =
    [ ( "expel", "Disconnect them" )
    , ( "refuse", "Refuse the connection" )
    , ( "quarantine", "Let them in, but silence them" )
    , ( "require_auth", "Require a signed-in account" )
    ]


actionName : String -> String
actionName action =
    actionOptions
        |> List.filter (\( v, _ ) -> v == action)
        |> List.head
        |> Maybe.map Tuple.second
        |> Maybe.withDefault action


scopeName : String -> String
scopeName scope =
    if scope == "mesh" then
        "whole mesh"

    else
        "this node"


kindKey : BanKind -> String
kindKey kind =
    case kind of
        Kline ->
            "kline"

        Dline ->
            "dline"

        Xline ->
            "xline"

        Ward ->
            "ward"


durationFields : { prefix : String, duration : OperPlan.Duration, choice : Field, amount : Field, unit : Field } -> Html Msg
durationFields config =
    div [ class "oc-duration" ]
        ([ K.field { id = config.prefix ++ "-duration", label = "For how long", hint = "" }
            (K.selectInput
                { id = config.prefix ++ "-duration"
                , value = config.duration.choice
                , options = OperPlan.durationPresets
                , onChange = edit config.choice
                , testId = config.prefix ++ "-duration"
                }
            )
         ]
            ++ (if config.duration.choice == "custom" then
                    [ div [ class "oc-row oc-row-tight" ]
                        [ K.field { id = config.prefix ++ "-amount", label = "Amount", hint = "" }
                            (K.textInput
                                { id = config.prefix ++ "-amount"
                                , value = config.duration.amount
                                , placeholder = "2"
                                , onChange = edit config.amount
                                , testId = config.prefix ++ "-amount"
                                , mono = True
                                , max = 6
                                }
                            )
                        , K.field { id = config.prefix ++ "-unit", label = "Unit", hint = "" }
                            (K.selectInput
                                { id = config.prefix ++ "-unit"
                                , value = config.duration.unit
                                , options = [ ( "minutes", "minutes" ), ( "hours", "hours" ), ( "days", "days" ) ]
                                , onChange = edit config.unit
                                , testId = config.prefix ++ "-unit"
                                }
                            )
                        ]
                    ]

                else
                    []
               )
        )


bansTab : Model -> Html Msg
bansTab model =
    let
        console =
            model.operConsole

        forms =
            console.forms

        ban =
            forms.ban

        ready =
            live model

        placeholderFor =
            case ban.kind of
                Kline ->
                    "*!*@bad.example"

                Dline ->
                    "203.0.113.0/24"

                Xline ->
                    "*bad?bot*"

                Ward ->
                    case ban.match of
                        "address" ->
                            "203.0.113.0/24"

                        "host" ->
                            "*.bad.example"

                        "account" ->
                            "spammer*"

                        "realname" ->
                            "*bad?bot*"

                        "country" ->
                            "RU"

                        "asn" ->
                            "15169"

                        "certfp" ->
                            "ab12cd34…"

                        _ ->
                            "*!*@bad.example"

        patternHint =
            case ban.kind of
                Xline ->
                    "A real name cannot hold a space; write ? where it would be."

                Dline ->
                    "An IP address, or a range such as 203.0.113.0/24."

                _ ->
                    "Use * for any run of characters. Masks that match almost everyone are refused."
    in
    div [ class "oc-panel", attribute "data-testid" "oc-panel-bans" ]
        (K.lede "Bans stop people at the door. Say who it covers, for how long, and why — the reason is recorded."
            :: pendingFor model Bans
            ++ [ K.card { id = "ban-add", title = "Add a ban", hint = "" }
                    [ form [ class "oc-form", attribute "data-testid" "oc-ban-form", onSubmit (run (BanAdd ban)) ]
                        ([ K.field { id = "oc-ban-kind", label = "Kind", hint = "" }
                            (K.selectInput
                                { id = "oc-ban-kind"
                                , value = kindKey ban.kind
                                , options = List.map (\k -> ( kindKey k, OperPlan.banKindLabel k )) OperPlan.banKinds
                                , onChange = edit BanKindField
                                , testId = "oc-ban-kind"
                                }
                            )
                         ]
                            ++ (if ban.kind == Ward then
                                    [ K.formRow
                                        [ K.field { id = "oc-ban-match", label = "Matches", hint = "" }
                                            (K.selectInput { id = "oc-ban-match", value = ban.match, options = facetOptions, onChange = edit BanMatch, testId = "oc-ban-match" })
                                        , K.field { id = "oc-ban-scope", label = "Applies to", hint = "" }
                                            (K.selectInput
                                                { id = "oc-ban-scope"
                                                , value = ban.scope
                                                , options = [ ( "node", "This node" ), ( "mesh", "Whole mesh" ) ]
                                                , onChange = edit BanScope
                                                , testId = "oc-ban-scope"
                                                }
                                            )
                                        ]
                                    , K.field { id = "oc-ban-action", label = "What happens", hint = "" }
                                        (K.selectInput { id = "oc-ban-action", value = ban.action, options = actionOptions, onChange = edit BanAction, testId = "oc-ban-action" })
                                    ]

                                else
                                    []
                               )
                            ++ [ K.field { id = "oc-ban-pattern", label = "Who", hint = patternHint }
                                    (K.textInput
                                        { id = "oc-ban-pattern"
                                        , value = ban.pattern
                                        , placeholder = placeholderFor
                                        , onChange = edit BanPattern
                                        , testId = "oc-ban-pattern"
                                        , mono = True
                                        , max = 256
                                        }
                                    )
                               , durationFields { prefix = "oc-ban", duration = ban.duration, choice = BanDurationChoice, amount = BanDurationAmount, unit = BanDurationUnit }
                               , K.field { id = "oc-ban-reason", label = "Reason", hint = "Recorded with the ban and shown to the person." }
                                    (K.textInput
                                        { id = "oc-ban-reason"
                                        , value = ban.reason
                                        , placeholder = "Spam wave from this host"
                                        , onChange = edit BanReason
                                        , testId = "oc-ban-reason"
                                        , mono = False
                                        , max = OperPlan.maxReasonLength
                                        }
                                    )
                               , K.formRow
                                    [ button
                                        [ type_ "submit"
                                        , class "oc-btn oc-btn-danger"
                                        , disabled (not ready || String.trim ban.pattern == "" || String.trim ban.reason == "")
                                        , attribute "data-testid" "oc-ban-submit"
                                        ]
                                        [ text "Review ban" ]
                                    ]
                               ]
                        )
                    ]
               , bansList model
               , checkBeforeBanning model
               , K.repliesLog model Bans
               ]
        )


bansList : Model -> Html Msg
bansList model =
    let
        listing =
            model.operConsole.wards
    in
    K.card { id = "ban-list", title = "Active bans", hint = "" }
        [ div [ class "oc-row oc-row-between" ]
            [ K.listingMeta model listing
            , K.button_
                { kind = "quiet"
                , label = "Refresh"
                , testId = "oc-bans-refresh"
                , onClick = refresh Bans
                , disabled = not (live model) || listing.loading
                , ariaLabel = Just "Refresh the ban list"
                }
            ]
        , if List.isEmpty listing.rows then
            K.emptyNote
                (if listing.loadedAtMs == Nothing then
                    "Waiting for the list."

                 else
                    "No bans are active on this node."
                )

          else
            ul [ class "oc-list", attribute "data-testid" "oc-ban-rows" ]
                (List.map (banRow (live model)) listing.rows)
        ]


banRow : Bool -> OperReply.Ward -> Html Msg
banRow ready ward =
    li [ class "oc-item", attribute "data-testid" "oc-ban-row" ]
        [ div [ class "oc-item-main" ]
            [ div [ class "oc-item-title" ]
                [ span [ class "oc-tag" ] [ text (facetName ward.match) ]
                , span [ class "oc-mono" ] [ text ward.pattern ]
                ]
            , p [ class "oc-item-sub" ]
                [ text (actionName ward.action ++ " · " ++ scopeName ward.scope ++ " · set by " ++ ward.setBy) ]
            , if ward.reason == "" then
                text ""

              else
                p [ class "oc-item-note" ] [ text ward.reason ]
            ]
        , K.button_
            { kind = "quiet"
            , label = "Lift"
            , testId = "oc-ban-lift"
            , onClick = run (BanRemove { match = ward.match, pattern = ward.pattern })
            , disabled = not ready
            , ariaLabel = Just ("Lift the ban on " ++ ward.pattern)
            }
        ]


checkBeforeBanning : Model -> Html Msg
checkBeforeBanning model =
    let
        forms =
            model.operConsole.forms

        ready =
            live model
    in
    K.disclosure { id = "ban-check", title = "Check before banning", hint = "See what a mask would catch", open = False }
        [ form [ class "oc-form", onSubmit (run (BanTest { match = forms.testMatch, value = forms.testValue })) ]
            [ K.formRow
                [ K.field { id = "oc-test-match", label = "Check against", hint = "" }
                    (K.selectInput { id = "oc-test-match", value = forms.testMatch, options = facetOptions, onChange = edit TestMatch, testId = "oc-test-match" })
                , K.field { id = "oc-test-value", label = "Value", hint = "" }
                    (K.textInput
                        { id = "oc-test-value"
                        , value = forms.testValue
                        , placeholder = "bob!user@host.example"
                        , onChange = edit TestValue
                        , testId = "oc-test-value"
                        , mono = True
                        , max = 256
                        }
                    )
                ]
            , K.formRow
                [ button [ type_ "submit", class "oc-btn oc-btn-quiet", disabled (not ready || String.trim forms.testValue == ""), attribute "data-testid" "oc-test-ward" ]
                    [ text "Does a ward match?" ]
                , K.button_
                    { kind = "quiet"
                    , label = "Is it banned?"
                    , testId = "oc-test-line"
                    , onClick = run (TestLine forms.testValue)
                    , disabled = not ready || String.trim forms.testValue == ""
                    , ariaLabel = Nothing
                    }
                , K.button_
                    { kind = "quiet"
                    , label = "Who would it catch?"
                    , testId = "oc-test-mask"
                    , onClick = run (TestMask forms.testValue)
                    , disabled = not ready || String.trim forms.testValue == ""
                    , ariaLabel = Nothing
                    }
                ]
            ]
        ]



-- SILENCE


silenceTab : Model -> Html Msg
silenceTab model =
    let
        console =
            model.operConsole

        forms =
            console.forms

        ready =
            live model
    in
    div [ class "oc-panel", attribute "data-testid" "oc-panel-silence" ]
        (K.lede "Quieter than a ban: the person stays connected, and what they say goes nowhere. Use the narrowest tool that works."
            :: pendingFor model Silence
            ++ [ K.card { id = "shun", title = "Shun", hint = "Everything they send is dropped, and they are not told." }
                    [ form [ class "oc-form", attribute "data-testid" "oc-shun-form", onSubmit (run (ShunAdd { mask = forms.shunMask, duration = forms.shunDuration, reason = forms.shunReason })) ]
                        [ K.field { id = "oc-shun-mask", label = "Who", hint = "A nick!user@host mask. Masks that match almost everyone are refused." }
                            (K.textInput
                                { id = "oc-shun-mask"
                                , value = forms.shunMask
                                , placeholder = "*!*@bad.example"
                                , onChange = edit ShunMask
                                , testId = "oc-shun-mask"
                                , mono = True
                                , max = 256
                                }
                            )
                        , durationFields { prefix = "oc-shun", duration = forms.shunDuration, choice = ShunDurationChoice, amount = ShunDurationAmount, unit = ShunDurationUnit }
                        , K.field { id = "oc-shun-reason", label = "Reason", hint = "" }
                            (K.textInput
                                { id = "oc-shun-reason"
                                , value = forms.shunReason
                                , placeholder = "Flooding after a warning"
                                , onChange = edit ShunReason
                                , testId = "oc-shun-reason"
                                , mono = False
                                , max = OperPlan.maxReasonLength
                                }
                            )
                        , K.formRow
                            [ button
                                [ type_ "submit"
                                , class "oc-btn oc-btn-danger"
                                , disabled (not ready || String.trim forms.shunMask == "" || String.trim forms.shunReason == "")
                                , attribute "data-testid" "oc-shun-submit"
                                ]
                                [ text "Review shun" ]
                            ]
                        ]
                    , shunList model
                    ]
               , K.card { id = "gag", title = "Gag", hint = "Silences everyone behind their address, and survives reconnecting." }
                    [ form [ class "oc-form", attribute "data-testid" "oc-gag-form", onSubmit (run (GagUser { nick = forms.gagNick, on = True })) ]
                        [ K.field { id = "oc-gag-nick", label = "Nickname", hint = "" }
                            (K.textInput
                                { id = "oc-gag-nick"
                                , value = forms.gagNick
                                , placeholder = "bob"
                                , onChange = edit GagNick
                                , testId = "oc-gag-nick"
                                , mono = False
                                , max = 50
                                }
                            )
                        , K.formRow
                            [ button
                                [ type_ "submit"
                                , class "oc-btn oc-btn-danger"
                                , disabled (not ready || String.trim forms.gagNick == "")
                                , attribute "data-testid" "oc-gag-submit"
                                ]
                                [ text "Review gag" ]
                            , K.button_
                                { kind = "quiet"
                                , label = "Lift a gag"
                                , testId = "oc-ungag-submit"
                                , onClick = run (GagUser { nick = forms.gagNick, on = False })
                                , disabled = not ready || String.trim forms.gagNick == ""
                                , ariaLabel = Nothing
                                }
                            ]
                        ]
                    ]
               , K.card { id = "quarantine", title = "Quarantine", hint = "Parts them from every room and moves them to one holding room." }
                    [ form [ class "oc-form", attribute "data-testid" "oc-quarantine-form", onSubmit (run (Quarantine { nick = forms.quarantineNick, channel = forms.quarantineChannel, reason = forms.quarantineReason })) ]
                        [ K.formRow
                            [ K.field { id = "oc-q-nick", label = "Nickname", hint = "" }
                                (K.textInput
                                    { id = "oc-q-nick"
                                    , value = forms.quarantineNick
                                    , placeholder = "bob"
                                    , onChange = edit QuarantineNick
                                    , testId = "oc-q-nick"
                                    , mono = False
                                    , max = 50
                                    }
                                )
                            , K.field { id = "oc-q-channel", label = "Holding room", hint = "" }
                                (K.textInput
                                    { id = "oc-q-channel"
                                    , value = forms.quarantineChannel
                                    , placeholder = "#quarantine"
                                    , onChange = edit QuarantineChannel
                                    , testId = "oc-q-channel"
                                    , mono = True
                                    , max = 64
                                    }
                                )
                            ]
                        , K.field { id = "oc-q-reason", label = "Reason", hint = "" }
                            (K.textInput
                                { id = "oc-q-reason"
                                , value = forms.quarantineReason
                                , placeholder = "Spamming rooms"
                                , onChange = edit QuarantineReason
                                , testId = "oc-q-reason"
                                , mono = False
                                , max = OperPlan.maxReasonLength
                                }
                            )
                        , K.formRow
                            [ button
                                [ type_ "submit"
                                , class "oc-btn oc-btn-danger"
                                , disabled (not ready || String.trim forms.quarantineNick == "" || String.trim forms.quarantineReason == "")
                                , attribute "data-testid" "oc-q-submit"
                                ]
                                [ text "Review quarantine" ]
                            ]
                        ]
                    ]
               , K.repliesLog model Silence
               ]
        )


shunList : Model -> Html Msg
shunList model =
    let
        listing =
            model.operConsole.shuns
    in
    div [ class "oc-sub" ]
        [ div [ class "oc-row oc-row-between" ]
            [ strong [ class "oc-sub-title" ] [ text "Active shuns" ]
            , K.button_
                { kind = "quiet"
                , label = "Refresh"
                , testId = "oc-shuns-refresh"
                , onClick = refresh Silence
                , disabled = not (live model) || listing.loading
                , ariaLabel = Just "Refresh the shun list"
                }
            ]
        , K.listingMeta model listing
        , if List.isEmpty listing.rows then
            K.emptyNote
                (if listing.loadedAtMs == Nothing then
                    "Waiting for the list."

                 else
                    "Nobody is shunned."
                )

          else
            ul [ class "oc-list", attribute "data-testid" "oc-shun-rows" ]
                (List.map
                    (\shun ->
                        li [ class "oc-item", attribute "data-testid" "oc-shun-row" ]
                            [ div [ class "oc-item-main" ]
                                [ div [ class "oc-item-title" ] [ span [ class "oc-mono" ] [ text shun.mask ] ]
                                , p [ class "oc-item-sub" ] [ text ("set by " ++ shun.setBy) ]
                                , if shun.reason == "" then
                                    text ""

                                  else
                                    p [ class "oc-item-note" ] [ text shun.reason ]
                                ]
                            , K.button_
                                { kind = "quiet"
                                , label = "Lift"
                                , testId = "oc-shun-lift"
                                , onClick = run (ShunRemove shun.mask)
                                , disabled = not (live model)
                                , ariaLabel = Just ("Lift the shun on " ++ shun.mask)
                                }
                            ]
                    )
                    listing.rows
                )
        ]



-- ABUSE


factLabel : String -> String
factLabel topic =
    case topic of
        "flood" ->
            "Flood guard"

        "shun" ->
            "Shunned"

        "dnsbl" ->
            "Blocklist"

        "reputation" ->
            "Connection reputation"

        "account" ->
            "Account"

        other ->
            other


factValue : String -> String -> String
factValue topic detail =
    case ( topic, detail ) of
        ( "shun", "yes" ) ->
            "Yes"

        ( "shun", "no" ) ->
            "No"

        ( "dnsbl", "clear" ) ->
            "Not listed"

        ( "dnsbl", "unknown" ) ->
            "Not checked"

        ( "dnsbl", _ ) ->
            if String.startsWith "listed" detail then
                "Listed (" ++ String.trim (String.dropLeft 6 detail) ++ ")"

            else
                detail

        ( "reputation", "none" ) ->
            "No address on record"

        ( "reputation", n ) ->
            "Score " ++ n ++ " (higher is worse)"

        ( "account", "none score=0" ) ->
            "Not signed in"

        ( "flood", _ ) ->
            if String.startsWith "none" detail then
                "Not throttled"

            else
                detail

        _ ->
            detail


flagged : ( String, String ) -> Bool
flagged ( topic, detail ) =
    case topic of
        "shun" ->
            detail == "yes"

        "dnsbl" ->
            String.startsWith "listed" detail

        "flood" ->
            not (String.startsWith "none" detail)

        _ ->
            False


abuseTab : Model -> Html Msg
abuseTab model =
    let
        console =
            model.operConsole

        forms =
            console.forms

        ready =
            live model
    in
    div [ class "oc-panel", attribute "data-testid" "oc-panel-abuse" ]
        (K.lede "Look before you act: why someone is throttled, who shares an address, and who is connected right now."
            :: pendingFor model Abuse
            ++ [ K.card { id = "abuse-check", title = "Check a person", hint = "" }
                    [ form [ class "oc-form", attribute "data-testid" "oc-abuse-form", onSubmit (run (AbuseCheck forms.abuseNick)) ]
                        [ K.formRow
                            [ K.field { id = "oc-abuse-nick", label = "Nickname", hint = "" }
                                (K.textInput
                                    { id = "oc-abuse-nick"
                                    , value = forms.abuseNick
                                    , placeholder = "bob"
                                    , onChange = edit AbuseNick
                                    , testId = "oc-abuse-nick"
                                    , mono = False
                                    , max = 50
                                    }
                                )
                            , button [ type_ "submit", class "oc-btn oc-btn-primary oc-btn-align", disabled (not ready || String.trim forms.abuseNick == ""), attribute "data-testid" "oc-abuse-submit" ]
                                [ text "Check" ]
                            ]
                        ]
                    , case console.abuse of
                        Just abuse ->
                            if List.isEmpty abuse.facts then
                                K.emptyNote ("Asking about " ++ abuse.nick ++ "…")

                            else
                                div [ class "oc-result", attribute "data-testid" "oc-abuse-result" ]
                                    [ p [ class "oc-result-head" ] [ text (C.abuseHeadline abuse) ]
                                    , dl [ class "oc-facts" ]
                                        (List.concatMap
                                            (\( topic, detail ) ->
                                                [ dt [] [ text (factLabel topic) ]
                                                , dd
                                                    [ attribute "data-flagged"
                                                        (if flagged ( topic, detail ) then
                                                            "true"

                                                         else
                                                            "false"
                                                        )
                                                    ]
                                                    [ text (factValue topic detail) ]
                                                ]
                                            )
                                            abuse.facts
                                        )
                                    ]

                        Nothing ->
                            text ""
                    ]
               , clonesCard model
               , sessionsCard model
               , K.repliesLog model Abuse
               ]
        )


clonesCard : Model -> Html Msg
clonesCard model =
    let
        clones =
            model.operConsole.clones
    in
    K.card { id = "clones", title = "Clone groups", hint = "People connecting from the same address or network." }
        [ K.formRow
            [ K.button_
                { kind = "primary"
                , label =
                    if clones.loading then
                        "Scanning…"

                    else
                        "Scan now"
                , testId = "oc-clones-scan"
                , onClick = run ClonesScan
                , disabled = not (live model) || clones.loading
                , ariaLabel = Nothing
                }
            ]
        , if clones.none then
            K.emptyNote "No clone groups found."

          else if List.isEmpty clones.groups && List.isEmpty clones.policy then
            text ""

          else
            div [ class "oc-result", attribute "data-testid" "oc-clones-result" ]
                (List.map
                    (\group ->
                        div [ class "oc-group" ]
                            [ p [ class "oc-group-head" ]
                                [ span [ class "oc-tag" ]
                                    [ text
                                        (if group.header.kind == "net" then
                                            "Network"

                                         else
                                            "Address"
                                        )
                                    ]
                                , span [ class "oc-mono" ] [ text group.header.key ]
                                , span [ class "oc-meta-inline" ] [ text (String.fromInt group.header.count ++ " connections") ]
                                ]
                            , ul [ class "oc-members" ]
                                (List.map
                                    (\member ->
                                        li []
                                            [ strong [] [ text member.nick ]
                                            , span [ class "oc-mono oc-faint" ] [ text (" " ++ member.ip) ]
                                            , span [ class "oc-faint" ]
                                                [ text
                                                    (if member.account == "*" then
                                                        " · not signed in"

                                                     else
                                                        " · " ++ member.account
                                                    )
                                                ]
                                            ]
                                    )
                                    group.members
                                )
                            ]
                    )
                    clones.groups
                    ++ (if List.isEmpty clones.policy then
                            []

                        else
                            [ details [ class "oc-more oc-more-inline" ]
                                [ summary [] [ span [ class "oc-more-title" ] [ text "Limits in force" ] ]
                                , ul [ class "oc-plain" ] (List.map (\line -> li [] [ text (String.dropLeft 7 line) ]) clones.policy)
                                ]
                            ]
                       )
                )
        ]


sessionsCard : Model -> Html Msg
sessionsCard model =
    let
        console =
            model.operConsole

        s =
            console.forms.sessions

        ready =
            live model
    in
    K.card { id = "sessions", title = "Who is connected", hint = "Filter the live session list." }
        [ form [ class "oc-form", attribute "data-testid" "oc-sessions-form", onSubmit (run (SessionsList s)) ]
            [ K.formRow
                [ K.field { id = "oc-s-who", label = "Show", hint = "" }
                    (K.selectInput
                        { id = "oc-s-who"
                        , value = s.who
                        , options = [ ( "", "Everyone" ), ( "oper", "Operators" ), ( "user", "Not operators" ) ]
                        , onChange = edit SessionsWho
                        , testId = "oc-s-who"
                        }
                    )
                , K.field { id = "oc-s-transport", label = "Connection", hint = "" }
                    (K.selectInput
                        { id = "oc-s-transport"
                        , value = s.transport
                        , options = [ ( "", "Any" ), ( "tls", "Encrypted" ), ( "clear", "Not encrypted" ) ]
                        , onChange = edit SessionsTransport
                        , testId = "oc-s-transport"
                        }
                    )
                ]
            , K.formRow
                [ K.field { id = "oc-s-account", label = "Account", hint = "* means signed in" }
                    (K.textInput { id = "oc-s-account", value = s.account, placeholder = "*", onChange = edit SessionsAccount, testId = "oc-s-account", mono = True, max = 128 })
                , K.field { id = "oc-s-ip", label = "Address", hint = "" }
                    (K.textInput { id = "oc-s-ip", value = s.ip, placeholder = "203.0.113.*", onChange = edit SessionsIp, testId = "oc-s-ip", mono = True, max = 128 })
                ]
            , K.formRow
                [ K.field { id = "oc-s-sort", label = "Sort", hint = "" }
                    (K.selectInput
                        { id = "oc-s-sort"
                        , value = s.sort
                        , options =
                            [ ( "-connected", "Newest first" )
                            , ( "connected", "Oldest first" )
                            , ( "nick", "Nickname" )
                            , ( "account", "Account" )
                            , ( "ip", "Address" )
                            ]
                        , onChange = edit SessionsSort
                        , testId = "oc-s-sort"
                        }
                    )
                , K.field { id = "oc-s-limit", label = "At most", hint = "" }
                    (K.textInput { id = "oc-s-limit", value = s.limit, placeholder = "50", onChange = edit SessionsLimit, testId = "oc-s-limit", mono = True, max = 3 })
                ]
            , K.formRow
                [ button [ type_ "submit", class "oc-btn oc-btn-primary", disabled (not ready || console.sessions.loading), attribute "data-testid" "oc-sessions-submit" ]
                    [ text
                        (if console.sessions.loading then
                            "Listing…"

                         else
                            "List sessions"
                        )
                    ]
                ]
            ]
        , if console.sessions.loadedAtMs /= Nothing || console.sessions.loading then
            K.listingMeta model console.sessions

          else
            text ""
        , if List.isEmpty console.sessions.rows then
            text ""

          else
            ul [ class "oc-list", attribute "data-testid" "oc-session-rows" ]
                (List.map
                    (\row ->
                        li [ class "oc-item oc-item-compact", attribute "data-testid" "oc-session-row" ]
                            [ div [ class "oc-item-main" ]
                                [ div [ class "oc-item-title" ]
                                    [ strong [] [ text row.nick ]
                                    , if row.oper then
                                        span [ class "oc-tag" ] [ text "Operator" ]

                                      else
                                        text ""
                                    ]
                                , p [ class "oc-item-sub" ]
                                    [ span [ class "oc-mono" ] [ text row.ip ]
                                    , text
                                        (" · "
                                            ++ (if row.account == "*" then
                                                    "not signed in"

                                                else
                                                    row.account
                                               )
                                            ++ " · "
                                            ++ (if row.tls then
                                                    "encrypted"

                                                else
                                                    "not encrypted"
                                               )
                                            ++ " · "
                                            ++ since row.seconds
                                        )
                                    ]
                                ]
                            ]
                    )
                    console.sessions.rows
                )
        ]


since : Int -> String
since seconds =
    if seconds >= 86400 then
        String.fromInt (seconds // 86400) ++ " d connected"

    else if seconds >= 3600 then
        String.fromInt (seconds // 3600) ++ " h connected"

    else if seconds >= 60 then
        String.fromInt (seconds // 60) ++ " min connected"

    else
        String.fromInt seconds ++ " s connected"



-- APPEALS


appealsTab : Model -> Html Msg
appealsTab model =
    let
        console =
            model.operConsole

        listing =
            console.appeals.listing

        ready =
            live model

        open =
            List.filter (not << .answered) listing.rows

        answered =
            List.filter .answered listing.rows
    in
    div [ class "oc-panel", attribute "data-testid" "oc-panel-appeals" ]
        (K.lede "People who were banned or silenced can ask for a second look, once an hour. Your answer is recorded and audited; the server does not message them."
            :: pendingFor model Appeals
            ++ [ K.card { id = "appeals", title = "Appeals", hint = "" }
                    [ div [ class "oc-row oc-row-between" ]
                        [ K.listingMeta model listing
                        , K.button_
                            { kind = "quiet"
                            , label = "Refresh"
                            , testId = "oc-appeals-refresh"
                            , onClick = refresh Appeals
                            , disabled = not ready || listing.loading
                            , ariaLabel = Just "Refresh the appeals"
                            }
                        ]
                    , if List.isEmpty listing.rows then
                        K.emptyNote
                            (if listing.loadedAtMs == Nothing then
                                "Waiting for the list."

                             else
                                "No appeals have been filed."
                            )

                      else
                        div [ class "oc-appeals" ]
                            (List.map (appealCard model ready) open
                                ++ (if List.isEmpty answered then
                                        []

                                    else
                                        [ details [ class "oc-more oc-more-inline", attribute "data-testid" "oc-appeals-answered" ]
                                            [ summary [] [ span [ class "oc-more-title" ] [ text ("Answered (" ++ String.fromInt (List.length answered) ++ ")") ] ]
                                            , div [ class "oc-appeals" ] (List.map (appealCard model ready) answered)
                                            ]
                                        ]
                                   )
                            )
                    ]
               , K.repliesLog model Appeals
               ]
        )


appealCard : Model -> Bool -> OperReply.Appeal -> Html Msg
appealCard model ready appeal =
    let
        console =
            model.operConsole

        answering =
            console.appeals.answering == Just appeal.id
    in
    div [ class "oc-appeal", attribute "data-testid" "oc-appeal", attribute "data-answered" (boolText appeal.answered) ]
        [ div [ class "oc-item-title" ]
            [ span [ class "oc-tag" ] [ text ("#" ++ String.fromInt appeal.id) ]
            , strong [] [ text appeal.nick ]
            , span [ class "oc-mono oc-faint" ] [ text appeal.host ]
            , span [ class "oc-meta-inline" ]
                [ text
                    (if appeal.answered then
                        "answered"

                     else
                        "open"
                    )
                ]
            ]
        , p [ class "oc-appeal-text" ] [ text appeal.text ]
        , if answering then
            form [ class "oc-form", attribute "data-testid" "oc-appeal-form", onSubmit (run (AppealAnswer { id = String.fromInt appeal.id, text = console.forms.appealAnswer })) ]
                [ K.field { id = "oc-appeal-answer", label = "Your answer", hint = "Recorded with your name in the audit log." }
                    (textarea
                        [ id "oc-appeal-answer"
                        , class "oc-input oc-textarea"
                        , rows 3
                        , maxlength OperPlan.maxAnswerLength
                        , value console.forms.appealAnswer
                        , placeholder "The ban was lifted. Thanks for waiting."
                        , attribute "data-testid" "oc-appeal-answer"
                        , onInput (edit AppealAnswerText)
                        ]
                        []
                    )
                , K.formRow
                    [ button [ type_ "submit", class "oc-btn oc-btn-primary", disabled (not ready || String.trim console.forms.appealAnswer == ""), attribute "data-testid" "oc-appeal-review" ]
                        [ text "Review answer" ]
                    , K.button_
                        { kind = "quiet"
                        , label = "Close"
                        , testId = "oc-appeal-close"
                        , onClick = K.consoleMsg (C.AnswerAppeal Nothing)
                        , disabled = False
                        , ariaLabel = Nothing
                        }
                    ]
                ]

          else
            K.formRow
                [ K.button_
                    { kind = "quiet"
                    , label =
                        if appeal.answered then
                            "Answer again"

                        else
                            "Answer"
                    , testId = "oc-appeal-answer-open"
                    , onClick = K.consoleMsg (C.AnswerAppeal (Just appeal.id))
                    , disabled = not ready
                    , ariaLabel = Just ("Answer appeal " ++ String.fromInt appeal.id ++ " from " ++ appeal.nick)
                    }
                ]
        ]


boolText : Bool -> String
boolText flag =
    if flag then
        "true"

    else
        "false"



-- CONTENT


contentTab : Model -> Html Msg
contentTab model =
    div [ class "oc-panel", attribute "data-testid" "oc-panel-content" ]
        (K.lede "Network-wide controls for what people can say and how new connections are tested. These apply to everyone who is not an operator."
            :: pendingFor model Content
            ++ [ filtersCard model
               , spamtrapCard model
               , holdCard model
               , policyCard model
               , challengeCard model
               , K.repliesLog model Content
               ]
        )


filtersCard : Model -> Html Msg
filtersCard model =
    let
        console =
            model.operConsole

        forms =
            console.forms

        listing =
            console.filters

        ready =
            live model
    in
    K.card { id = "filters", title = "Word filter", hint = "Messages that contain a pattern are blocked for everyone who is not an operator." }
        [ form [ class "oc-form", attribute "data-testid" "oc-filter-form", onSubmit (run (FilterAdd forms.filterPattern)) ]
            [ K.field { id = "oc-filter-pattern", label = "Block this text", hint = "Not case-sensitive. At least three characters; spaces are kept." }
                (K.textInput
                    { id = "oc-filter-pattern"
                    , value = forms.filterPattern
                    , placeholder = "free money"
                    , onChange = edit FilterPattern
                    , testId = "oc-filter-pattern"
                    , mono = False
                    , max = 120
                    }
                )
            , K.formRow
                [ button [ type_ "submit", class "oc-btn oc-btn-danger", disabled (not ready || String.trim forms.filterPattern == ""), attribute "data-testid" "oc-filter-submit" ]
                    [ text "Review filter" ]
                ]
            ]
        , div [ class "oc-row oc-row-between" ]
            [ K.listingMeta model listing
            , K.button_
                { kind = "quiet"
                , label = "Refresh"
                , testId = "oc-filters-refresh"
                , onClick = refresh Content
                , disabled = not ready || listing.loading
                , ariaLabel = Just "Refresh the filter list"
                }
            ]
        , if List.isEmpty listing.rows then
            K.emptyNote
                (if listing.loadedAtMs == Nothing then
                    "Waiting for the list."

                 else
                    "No patterns are blocked."
                )

          else
            ul [ class "oc-list", attribute "data-testid" "oc-filter-rows" ]
                (List.map
                    (\row ->
                        li [ class "oc-item oc-item-compact", attribute "data-testid" "oc-filter-row" ]
                            [ div [ class "oc-item-main" ] [ div [ class "oc-item-title" ] [ span [ class "oc-mono" ] [ text row.pattern ] ] ]
                            , K.button_
                                { kind = "quiet"
                                , label = "Remove"
                                , testId = "oc-filter-remove"
                                , onClick = run (FilterRemove row.pattern)
                                , disabled = not ready
                                , ariaLabel = Just ("Stop blocking " ++ row.pattern)
                                }
                            ]
                    )
                    listing.rows
                )
        ]


spamtrapCard : Model -> Html Msg
spamtrapCard model =
    let
        console =
            model.operConsole

        forms =
            console.forms

        ready =
            live model
    in
    K.disclosure { id = "spamtrap", title = "Spam traps", hint = "Honeypot nicks and rooms that flag whoever touches them", open = False }
        [ case console.spamtrap of
            Just summary ->
                p [ class "oc-result-head", attribute "data-testid" "oc-spamtrap-summary" ]
                    [ text
                        (String.fromInt summary.nicks
                            ++ " trap nicks, "
                            ++ String.fromInt summary.channels
                            ++ " trap rooms, "
                            ++ String.fromInt summary.offenders
                            ++ " flagged, "
                            ++ String.fromInt summary.trips
                            ++ " trips in total."
                        )
                    ]

            Nothing ->
                K.emptyNote "Counters load with this tab."
        , form [ class "oc-form", attribute "data-testid" "oc-spamtrap-form", onSubmit (run (SpamtrapSet { add = True, kind = forms.spamKind, target = forms.spamTarget })) ]
            [ K.formRow
                [ K.field { id = "oc-spam-kind", label = "Trap a", hint = "" }
                    (K.selectInput
                        { id = "oc-spam-kind"
                        , value = forms.spamKind
                        , options = [ ( "NICK", "Nickname" ), ( "CHAN", "Room" ) ]
                        , onChange = edit SpamKind
                        , testId = "oc-spam-kind"
                        }
                    )
                , K.field { id = "oc-spam-target", label = "Name", hint = "" }
                    (K.textInput { id = "oc-spam-target", value = forms.spamTarget, placeholder = "honeypot", onChange = edit SpamTarget, testId = "oc-spam-target", mono = True, max = 64 })
                ]
            , K.formRow
                [ button [ type_ "submit", class "oc-btn oc-btn-primary", disabled (not ready || String.trim forms.spamTarget == ""), attribute "data-testid" "oc-spam-add" ]
                    [ text "Review trap" ]
                , K.button_
                    { kind = "quiet"
                    , label = "Remove this trap"
                    , testId = "oc-spam-del"
                    , onClick = run (SpamtrapSet { add = False, kind = forms.spamKind, target = forms.spamTarget })
                    , disabled = not ready || String.trim forms.spamTarget == ""
                    , ariaLabel = Nothing
                    }
                ]
            ]
        ]


holdCard : Model -> Html Msg
holdCard model =
    let
        forms =
            model.operConsole.forms

        ready =
            live model
    in
    K.disclosure { id = "hold", title = "Held first messages", hint = "Release or discard what a new member said before review", open = False }
        [ form [ class "oc-form", attribute "data-testid" "oc-hold-form", onSubmit (run (HoldAct { release = True, channel = forms.holdChannel, nick = forms.holdNick })) ]
            [ K.formRow
                [ K.field { id = "oc-hold-channel", label = "Room", hint = "" }
                    (K.textInput { id = "oc-hold-channel", value = forms.holdChannel, placeholder = "#lounge", onChange = edit HoldChannel, testId = "oc-hold-channel", mono = True, max = 64 })
                , K.field { id = "oc-hold-nick", label = "Member", hint = "" }
                    (K.textInput { id = "oc-hold-nick", value = forms.holdNick, placeholder = "bob", onChange = edit HoldNick, testId = "oc-hold-nick", mono = False, max = 50 })
                ]
            , K.formRow
                [ button [ type_ "submit", class "oc-btn oc-btn-primary", disabled (not ready || String.trim forms.holdNick == "" || String.trim forms.holdChannel == ""), attribute "data-testid" "oc-hold-release" ]
                    [ text "Review release" ]
                , K.button_
                    { kind = "danger"
                    , label = "Discard instead"
                    , testId = "oc-hold-drop"
                    , onClick = run (HoldAct { release = False, channel = forms.holdChannel, nick = forms.holdNick })
                    , disabled = not ready || String.trim forms.holdNick == "" || String.trim forms.holdChannel == ""
                    , ariaLabel = Nothing
                    }
                ]
            ]
        ]


policyCard : Model -> Html Msg
policyCard model =
    let
        console =
            model.operConsole

        ready =
            live model
    in
    K.disclosure { id = "policy", title = "Policy history", hint = "Undo the last ward, filter, class or ban change", open = False }
        [ case console.policy of
            Just gens ->
                dl [ class "oc-facts", attribute "data-testid" "oc-policy-gens" ]
                    [ dt [] [ text "Bans" ]
                    , dd [] [ text ("generation " ++ String.fromInt gens.ward) ]
                    , dt [] [ text "Word filter" ]
                    , dd [] [ text ("generation " ++ String.fromInt gens.filter) ]
                    , dt [] [ text "Connection classes" ]
                    , dd [] [ text ("generation " ++ String.fromInt gens.class) ]
                    , dt [] [ text "Channel bans" ]
                    , dd [] [ text ("generation " ++ String.fromInt gens.ban) ]
                    ]

            Nothing ->
                K.emptyNote "Generations load with this tab."
        , K.formRow
            [ K.button_
                { kind = "quiet"
                , label = "Refresh"
                , testId = "oc-policy-refresh"
                , onClick = run PolicyShow
                , disabled = not ready
                , ariaLabel = Nothing
                }
            , K.button_
                { kind = "danger"
                , label = "Review rollback"
                , testId = "oc-policy-rollback"
                , onClick = run PolicyRollback
                , disabled = not ready
                , ariaLabel = Just "Review rolling back the last policy change"
                }
            ]
        ]


challengeCard : Model -> Html Msg
challengeCard model =
    let
        forms =
            model.operConsole.forms

        ready =
            live model
    in
    K.disclosure { id = "challenge", title = "Raid challenge", hint = "How new connections prove they are people while a raid is on", open = False }
        [ p [ class "oc-hint" ] [ text "Only used while a raid shield is engaged. The answer is a shared secret: it is never written to the reply log." ]
        , K.formRow
            [ K.button_
                { kind = "quiet"
                , label = "Use proof of work"
                , testId = "oc-challenge-pow"
                , onClick = run (ChallengeMethod "pow")
                , disabled = not ready
                , ariaLabel = Nothing
                }
            , K.button_
                { kind = "quiet"
                , label = "Use a question"
                , testId = "oc-challenge-question-method"
                , onClick = run (ChallengeMethod "question")
                , disabled = not ready
                , ariaLabel = Nothing
                }
            ]
        , form [ class "oc-form", attribute "data-testid" "oc-challenge-form", onSubmit (run (ChallengeQuestion { question = forms.challengeQuestion, answer = forms.challengeAnswer })) ]
            [ K.field { id = "oc-challenge-q", label = "Question", hint = "One short phrase; spaces become underscores." }
                (K.textInput { id = "oc-challenge-q", value = forms.challengeQuestion, placeholder = "type-the-word-cat", onChange = edit ChallengeQuestionText, testId = "oc-challenge-q", mono = False, max = 160 })
            , K.field { id = "oc-challenge-a", label = "Answer", hint = "Compared exactly." }
                (K.textInput { id = "oc-challenge-a", value = forms.challengeAnswer, placeholder = "cat", onChange = edit ChallengeAnswerText, testId = "oc-challenge-a", mono = False, max = 64 })
            , K.formRow
                [ button [ type_ "submit", class "oc-btn oc-btn-primary", disabled (not ready || String.trim forms.challengeQuestion == "" || String.trim forms.challengeAnswer == ""), attribute "data-testid" "oc-challenge-submit" ]
                    [ text "Review question" ]
                ]
            ]
        ]
