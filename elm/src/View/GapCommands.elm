module View.GapCommands exposing (actionLead, commandsHelp, singleKeysSwitch)

{-| v3/gap-commands — the `/help` slash-commands sheet, the single-key
shortcuts switch the `?` overlay carries, and the `* nick` lead of an
action (`/me`) row.

The sheet lists only verbs that work against Onyx Server
(`App.slashHelpGroups`): every row is a button that drops `/<verb> `
into the composer, so the list doubles as a launcher. It is a centred
dialog on wide screens and a bottom sheet on phones (`View.Sheet`).

-}

import App exposing (Model, Msg(..))
import Avatar
import Html exposing (Html, button, code, div, h3, section, span, strong, text)
import Html.Attributes exposing (attribute, class, id, style, type_)
import Html.Events exposing (onClick)
import View.Sheet as Sheet


commandsHelp : Model -> Html Msg
commandsHelp model =
    if not model.commandsHelpOpen then
        text ""

    else
        let
            canInsert =
                model.activeChannel /= Nothing
        in
        Sheet.view
            { scope = "commands-help"
            , label = Sheet.LabelledBy "gap-help-title"
            , onClose = CommandsHelpClose
            , placement = Sheet.Center
            , layerClass = "gap-help"
            , panelClass = "gap-help-sheet"
            , backdropClass = ""
            , layerAttrs = []
            , modal = True
            , attrs = [ attribute "aria-describedby" "gap-help-desc", attribute "data-testid" "commands-help" ]
            }
            [ Sheet.headerWith
                (Sheet.head { scope = "commands-help", title = "Slash commands", closeLabel = "Close slash commands", onClose = CommandsHelpClose }
                    |> (\h ->
                            { h
                                | titleId = Just "gap-help-title"
                                , subtitle =
                                    Just
                                        (if canInsert then
                                            "Type one in the composer, or pick one to start it. /help <command> explains one."

                                         else
                                            "Open a conversation to use them. /help <command> explains one."
                                        )
                                , subtitleId = Just "gap-help-desc"
                                , closeAttrs = [ Sheet.autofocus "commands-help" ]
                            }
                       )
                )
            , div [ class "gap-help-groups" ]
                (List.map (groupView canInsert) (App.slashHelpGroups model.isOper))
            ]


groupView : Bool -> ( String, List App.SlashCommand ) -> Html Msg
groupView canInsert ( group, commands ) =
    let
        headingId =
            "gap-help-" ++ String.toLower (String.replace " " "-" group)
    in
    section [ class "gap-help-group", attribute "aria-labelledby" headingId ]
        [ h3 [ class "gap-help-group-name", id headingId ] [ text group ]
        , div [ class "gap-help-rows", attribute "role" "list" ]
            (List.map (commandRow canInsert) commands)
        ]


commandRow : Bool -> App.SlashCommand -> Html Msg
commandRow canInsert command =
    let
        aliases =
            if List.isEmpty command.aliases then
                text ""

            else
                span [ class "gap-help-alias" ] [ text ("also " ++ String.join ", " (List.map (\a -> "/" ++ a) command.aliases)) ]

        body =
            [ code [ class "gap-help-usage" ] [ text command.usage ]
            , span [ class "gap-help-desc" ] [ text command.description, aliases ]
            ]
    in
    div [ class "gap-help-item", attribute "role" "listitem" ]
        [ if canInsert then
            button
                [ type_ "button"
                , class "gap-help-row"
                , attribute "data-command" command.name
                , attribute "aria-label" (command.usage ++ " — " ++ command.description)
                , onClick (CommandsHelpInsert command.name)
                ]
                body

          else
            div [ class "gap-help-row", attribute "data-command" command.name ] body
        ]


{-| The single-character shortcuts switch (WCAG 2.1.4: a way to turn
them off). Stored on this device; `ports.js` reads it on every key. -}
singleKeysSwitch : Model -> Html Msg
singleKeysSwitch model =
    button
        [ type_ "button"
        , class "gap-keys-pref"
        , attribute "role" "switch"
        , attribute "aria-checked"
            (if model.singleKeyShortcuts then
                "true"

             else
                "false"
            )
        , attribute "aria-label" "Single-key shortcuts"
        , attribute "aria-describedby" "gap-keys-pref-hint"
        , attribute "data-testid" "single-keys-switch"
        , onClick SingleKeysToggle
        ]
        [ span [ class "gap-keys-pref-text" ]
            [ span [ class "gap-keys-pref-title" ] [ text "Single-key shortcuts" ]
            , span [ class "gap-keys-pref-hint", id "gap-keys-pref-hint" ]
                [ text "J, K, N, U, G, ? and / act without a modifier key. Turn them off if they get in the way of a screen reader or voice control." ]
            ]
        , span [ class "gap-keys-pref-switch", attribute "aria-hidden" "true" ] []
        ]


{-| The lead of an action row: `* nick`, tinted like the sender name. -}
actionLead : String -> Html msg
actionLead nick =
    span [ class "onyx-action-lead" ]
        [ span [ class "onyx-action-star", attribute "aria-hidden" "true" ] [ text "*" ]
        , strong [ class "onyx-sender onyx-action-nick", style "color" (Avatar.nickTint nick) ] [ text nick ]
        , text " "
        ]
