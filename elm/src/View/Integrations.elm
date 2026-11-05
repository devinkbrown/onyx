module View.Integrations exposing (serviceIntegrationPanel)

{-| Typed service operations. The view contains no IRC line builders and no
private OUTHOOK fields: those stay in the runtime-owned private form.
-}

import App exposing (Msg(..), ServiceIntegrationForm)
import Char
import Html exposing (Html, button, div, h3, input, label, li, p, section, span, text, ul)
import Html.Attributes exposing (attribute, class, disabled, for, placeholder, type_, value)
import Html.Events exposing (onClick, onInput)
import Integrations
import RuntimeDomain
import String


serviceIntegrationPanel : Maybe RuntimeDomain.ServiceIntegrationView -> ServiceIntegrationForm -> Html App.Msg
serviceIntegrationPanel maybeView formState =
    let
        feature =
            maybeView |> Maybe.map .feature |> Maybe.withDefault "botgrant"

        view =
            maybeView

        pending =
            view |> Maybe.map (.phase >> (==) "pending") |> Maybe.withDefault False

        featureRegistered =
            view |> Maybe.map (.registry >> (==) "enabled") |> Maybe.withDefault False

        accountReady =
            view |> Maybe.map (.accountProof >> (/=) "required") |> Maybe.withDefault False

        -- Only a server-confirmed "enabled" state unlocks mutations; "unknown"
        -- fails closed like "disabled".
        featureDisabled =
            view |> Maybe.map (.effectiveFeature >> (/=) "enabled") |> Maybe.withDefault True

        permissionDenied =
            view |> Maybe.map (.authorization >> (==) "denied") |> Maybe.withDefault False

        run action =
            App.RuntimeDomainActionRequested action

        fieldInput labelText fieldName current placeholderText =
            label [ class "onyx-service-field" ]
                [ span [] [ text labelText ]
                , input
                    [ type_ "text"
                    , value current
                    , placeholder placeholderText
                    , onInput (App.ServiceIntegrationFieldChanged fieldName)
                    ]
                    []
                ]

        actionButton labelText action =
            button [ type_ "button", disabled (pending || not featureRegistered || not accountReady || featureDisabled || permissionDenied), onClick (run action) ] [ text labelText ]

        explicitOffButton =
            button [ type_ "button", disabled (pending || not featureRegistered || permissionDenied), onClick (run RuntimeDomain.ServiceUnfurlOff) ] [ text "Check and refuse previews" ]

        refreshButton labelText featureName =
            button [ type_ "button", disabled pending, onClick (run (RuntimeDomain.ServiceRefresh featureName)) ] [ text labelText ]

        optionalActionButton labelText maybeAction =
            case maybeAction of
                Just action -> actionButton labelText action
                Nothing -> button [ type_ "button", disabled True ] [ text (labelText ++ " (check the value)") ]

        refreshButtons =
            div [ class "onyx-service-refresh" ]
                (List.map
                    (\(name, key) -> refreshButton ("Refresh " ++ name) key)
                    [ ( "bot grants", "botgrant" ), ( "bot commands", "botcmd" ), ( "deferred actions", "defer" ), ( "outbound hooks", "outhook" ), ( "link previews", "unfurl" ), ( "offline memos", "memo" ), ( "incoming webhooks", "webhook" ) ]
                )

        rows =
            view
                |> Maybe.map .rows
                |> Maybe.withDefault []
                |> List.map
                    (\row ->
                        li [ attribute "data-row-kind" row.kind ]
                            [ span [ class "onyx-service-row-label" ] [ text row.label ]
                            , row.value |> Maybe.map (\item -> span [ class "onyx-service-row-value" ] [ text item ]) |> Maybe.withDefault (text "")
                            , if feature == "outhook" then
                                case row.ref of
                                    Just urlRef ->
                                        span [ class "onyx-service-row-actions" ]
                                            [ button [ type_ "button", disabled pending, onClick (run (RuntimeDomain.ServiceOutHookInspect urlRef)) ] [ text "Inspect private URL" ]
                                            , button [ type_ "button", disabled (pending || not featureRegistered || not accountReady || featureDisabled || permissionDenied), onClick (run (RuntimeDomain.ServiceOutHookRemove urlRef)) ] [ text "Remove hook" ]
                                            ]

                                    Nothing ->
                                        text ""

                              else
                                text ""
                            ]
                    )

        operationPanel =
            case feature of
                "botgrant" ->
                    section [ class "onyx-service-controls" ]
                        [ h3 [] [ text "Bot grants" ]
                        , fieldInput "Account" "account" formState.account "account name"
                        , fieldInput "Channel" "channel" formState.channel "#channel"
                        , fieldInput "Lifetime in seconds" "ttlSeconds" formState.ttlSeconds "3600"
                        , div []
                            [ actionButton "List grants" (RuntimeDomain.ServiceBotGrantList (maybeText formState.account))
                            , optionalActionButton "Grant speak" (Maybe.map (\seconds -> RuntimeDomain.ServiceBotGrantAdd formState.account "speak" formState.channel seconds) (safeInt 1 31536000 formState.ttlSeconds))
                            , optionalActionButton "Grant webhook" (Maybe.map (\seconds -> RuntimeDomain.ServiceBotGrantAdd formState.account "webhook" formState.channel seconds) (safeInt 1 31536000 formState.ttlSeconds))
                            , optionalActionButton "Grant history" (Maybe.map (\seconds -> RuntimeDomain.ServiceBotGrantAdd formState.account "history" formState.channel seconds) (safeInt 1 31536000 formState.ttlSeconds))
                            , actionButton "Revoke grant" (RuntimeDomain.ServiceBotGrantRemove formState.account formState.grantKind formState.channel)
                            ]
                        , fieldInput "Grant type to revoke" "grantKind" formState.grantKind "speak, webhook, or history"
                        ]

                "botcmd" ->
                    section [ class "onyx-service-controls" ]
                        [ h3 [] [ text "Bot commands" ]
                        , fieldInput "Command name" "botCommandName" formState.botCommandName "name"
                        , fieldInput "Argument count" "botCommandArgc" formState.botCommandArgc "0"
                        , fieldInput "Help text" "botCommandHelp" formState.botCommandHelp "Short help"
                        , fieldInput "Arguments" "botCommandArgs" formState.botCommandArgs "space-separated"
                        , div []
                            [ actionButton "List bot commands" RuntimeDomain.ServiceBotCommandList
                            , optionalActionButton "Add bot command" (Maybe.map (\argc -> RuntimeDomain.ServiceBotCommandAdd formState.botCommandName argc formState.botCommandHelp) (safeInt 0 16 formState.botCommandArgc))
                            , actionButton "Run bot command" (RuntimeDomain.ServiceBotCommandRun formState.botCommandName (String.words formState.botCommandArgs))
                            ]
                        ]

                "defer" ->
                    section [ class "onyx-service-controls" ]
                        [ h3 [] [ text "Defer a channel message or mode" ]
                        , fieldInput "Channel" "channel" formState.channel "#channel"
                        , fieldInput "Unix time in milliseconds" "deferUnixMs" formState.deferUnixMs "1780000000000"
                        , fieldInput "Cron minute" "cronMinute" formState.cronMinute "*"
                        , fieldInput "Cron hour" "cronHour" formState.cronHour "*"
                        , fieldInput "Cron day of month" "cronDayOfMonth" formState.cronDayOfMonth "*"
                        , fieldInput "Cron month" "cronMonth" formState.cronMonth "*"
                        , fieldInput "Cron day of week" "cronDayOfWeek" formState.cronDayOfWeek "*"
                        , fieldInput "Operator mode letter" "operatorMode" formState.operatorMode "m"
                        , fieldInput "Message text" "text" formState.text "Message"
                        , div []
                            [ optionalActionButton "Schedule once" (Maybe.map (\timestamp -> RuntimeDomain.ServiceDeferAt timestamp formState.channel formState.text) (safeUnixMilliseconds formState.deferUnixMs))
                            , actionButton "Schedule cron" (RuntimeDomain.ServiceDeferCron formState.cronMinute formState.cronHour formState.cronDayOfMonth formState.cronMonth formState.cronDayOfWeek formState.channel formState.text)
                            , optionalActionButton "Schedule operator mode once" (Maybe.map (\timestamp -> RuntimeDomain.ServiceDeferOperAt timestamp formState.channel) (safeUnixMilliseconds formState.deferUnixMs) |> Maybe.andThen (\partial -> Maybe.map partial (singleMode formState.operatorMode)))
                            , optionalActionButton "Schedule operator mode by cron" (Maybe.map (\mode -> RuntimeDomain.ServiceDeferOperCron formState.cronMinute formState.cronHour formState.cronDayOfMonth formState.cronMonth formState.cronDayOfWeek formState.channel mode) (singleMode formState.operatorMode))
                            ]
                        ]

                "outhook" ->
                    section [ class "onyx-service-controls" ]
                        [ h3 [] [ text "Outbound hooks" ]
                        , p [] [ text "Hook URLs, secrets, and categories are entered in a private runtime form and are not shown in the client model." ]
                        , div []
                            [ actionButton "List hooks" RuntimeDomain.ServiceOutHookList
                            , actionButton "Add hook privately" RuntimeDomain.ServiceOutHookInput
                            , case view |> Maybe.andThen .inputRef of
                                Just inputRef -> actionButton "Confirm private hook details" (RuntimeDomain.ServiceOutHookAdd inputRef)
                                Nothing -> text ""
                            ]
                        ]

                "unfurl" ->
                    section [ class "onyx-service-controls" ]
                        [ h3 [] [ text "Link previews" ]
                        , p [] [ text "Send OFF to check whether previews are configured. ON is available only after the server confirms the feature is enabled." ]
                        , fieldInput "HTTPS URL to preview" "unfurlUrl" formState.unfurlUrl "https://example.org/page"
                        , div []
                            [ explicitOffButton
                            , button [ type_ "button", disabled (pending || not featureRegistered || not accountReady || permissionDenied || (view |> Maybe.map (.effectiveFeature >> (/=) "enabled") |> Maybe.withDefault True)), onClick (run RuntimeDomain.ServiceUnfurlOn) ] [ text "Opt in to previews" ]
                            , button [ type_ "button", disabled (pending || not featureRegistered || not accountReady || permissionDenied || (view |> Maybe.map (.effectiveFeature >> (/=) "enabled") |> Maybe.withDefault True) || not (String.startsWith "https://" formState.unfurlUrl)), onClick (run (RuntimeDomain.ServiceUnfurlPreview formState.unfurlUrl)) ] [ text "Fetch this preview" ]
                            ]
                        ]

                "memo" ->
                    section [ class "onyx-service-controls" ]
                        [ h3 [] [ text "Offline memos" ]
                        , fieldInput "Recipient account" "account" formState.account "account name"
                        , fieldInput "Memo text" "text" formState.text "Message"
                        , fieldInput "Forward memos to" "memoForwardAccount" formState.memoForwardAccount "account name"
                        , div []
                            [ actionButton "Send through Outbox" (RuntimeDomain.ServiceMemoSend formState.account formState.text)
                            , actionButton "List offline memos" RuntimeDomain.ServiceMemoList
                            , actionButton "Clear offline memos" RuntimeDomain.ServiceMemoClear
                            , actionButton "Set forward account" (RuntimeDomain.ServiceMemoForward (maybeText formState.memoForwardAccount))
                            , actionButton "Disable memo forwarding" (RuntimeDomain.ServiceMemoForward Nothing)
                            , actionButton "List ignored senders" RuntimeDomain.ServiceMemoIgnoreList
                            , actionButton "Ignore account" (RuntimeDomain.ServiceMemoIgnoreAdd formState.account)
                            , actionButton "Stop ignoring account" (RuntimeDomain.ServiceMemoIgnoreRemove formState.account)
                            ]
                        ]

                _ ->
                    section [] [ h3 [] [ text "Incoming webhooks" ], p [] [ text "Use the refreshed server registry to see whether WEBHOOK is available on this connection." ] ]

        status =
            case view of
                Nothing ->
                    []

                Just current ->
                    [ p [ class "onyx-service-status", attribute "role" "status" ]
                        [ text
                            (if current.feature == "memo" && current.operation == Just "send" && current.phase == "accepted" then
                                "Queued locally. Delivery has not been confirmed."

                             else
                                Integrations.phaseLabel current.phase
                            )
                        ]
                    , p [ class "onyx-service-status" ] [ text ("Command registry: " ++ current.registry ++ ". Effective setting: " ++ current.effectiveFeature ++ ". Account proof: " ++ current.accountProof ++ ". Authorization: " ++ current.authorization ++ ".") ]
                    , current.reason |> Integrations.reasonLabel |> Maybe.map (\message -> p [ class "onyx-service-reason", attribute "role" "status" ] [ text message ]) |> Maybe.withDefault (text "")
                    ]
    in
    section [ class "onyx-service-integrations", attribute "aria-label" "Server integrations", attribute "data-testid" "service-integrations" ]
        ([ h3 [] [ text "Server integrations" ]
         , p [] [ text ("Selected service: " ++ Integrations.featureLabel feature) ]
         , refreshButtons
         , button [ type_ "button", onClick ServiceIntegrationFormReset ] [ text "Clear unsaved integration fields" ]
         , operationPanel
         ]
            ++ status
            ++ [ ul [ class "onyx-service-rows" ] rows ]
        )


maybeText : String -> Maybe String
maybeText raw =
    let value_ = String.trim raw in
    if String.isEmpty value_ then Nothing else Just value_


safeInt : Int -> Int -> String -> Maybe Int
safeInt minimum maximum raw =
    let
        digitsOnly = not (String.isEmpty raw) && List.all Char.isDigit (String.toList raw)
    in
    if not digitsOnly then
        Nothing

    else
        String.toInt raw
            |> Maybe.andThen (\value_ -> if value_ >= minimum && value_ <= maximum then Just value_ else Nothing)


safeUnixMilliseconds : String -> Maybe Float
safeUnixMilliseconds raw =
    let
        digitsOnly = not (String.isEmpty raw) && List.all Char.isDigit (String.toList raw)
    in
    if not digitsOnly then
        Nothing

    else
        String.toFloat raw
            |> Maybe.andThen (\value_ -> if value_ >= 0 && value_ <= 9007199254740991 then Just value_ else Nothing)


singleMode : String -> Maybe Char
singleMode raw =
    case String.toList (String.trim raw) of
        [ value_ ] ->
            let code = Char.toCode value_ in
            if (code >= 65 && code <= 90) || (code >= 97 && code <= 122) then Just value_ else Nothing
        _ -> Nothing
