module View.Switcher exposing (paletteLauncher, palette, shortcutsOverlay)

{-| v3/switcher — the Ctrl/Cmd+K action palette (mirroring
`chat/spotlight/Spotlight.tsx`) and the `?` keyboard-shortcuts overlay
(mirroring `shell/ShortcutsOverlay.tsx`).

Combobox pattern: the input keeps DOM focus, the listbox highlight is
virtual (`aria-activedescendant`), ↑/↓ wrap, Enter runs the highlighted
row, Escape closes (handled on the input with `preventDefault`, so the
global `shortcut` port ignores the already-claimed key). Options take
`mousedown` default-prevented so a click never steals input focus.
Initial focus and focus restore to the opener live in `ports.js`
(`data-onyx-autofocus`), like the other sheets' focus work.

The time-grammar example chips of the oracle are not ported (no time
grammar in this client).

-}

import App exposing (Model, Msg(..))
import Dict
import Html exposing (Html, button, div, h2, h3, input, kbd, mark, p, section, span, text)
import Html.Attributes exposing (attribute, class, id, placeholder, type_, value)
import Html.Events exposing (onClick, onInput, preventDefaultOn, on)
import Json.Decode as Decode
import Switcher
import View.Sheet as Sheet


listboxId : String
listboxId =
    "onyx-spotlight-listbox"


{-| Topbar launcher (touch users have no Ctrl+K). -}
paletteLauncher : Model -> Html Msg
paletteLauncher model =
    button
        [ type_ "button"
        , class "onyx-palette-launcher"
        , attribute "aria-label" "Open command palette"
        , attribute "aria-keyshortcuts" "Control+K Meta+K"
        , attribute "aria-expanded"
            (if model.palette.open then
                "true"

             else
                "false"
            )
        , attribute "aria-haspopup" "dialog"
        , attribute "data-testid" "palette-launcher"
        , onClick PaletteOpen
        ]
        [ span [ class "onyx-palette-launcher-label" ] [ text "Jump to…" ]
        , kbd [ class "onyx-palette-kbd", attribute "aria-hidden" "true" ] [ text "Ctrl K" ]
        ]


palette : Model -> Html Msg
palette model =
    if model.palette.open then
        paletteDialog model

    else
        text ""


paletteDialog : Model -> Html Msg
paletteDialog model =
    let
        query =
            model.palette.query

        matched =
            Switcher.matches query
                (Switcher.entries (App.isChannelName model) model.activeChannel (Dict.values model.channels))

        count =
            List.length matched

        active =
            Switcher.clampActive count model.palette.active

        activeHint =
            case List.head (List.drop active matched) of
                Just m ->
                    "Selected command: " ++ m.entry.title

                Nothing ->
                    if String.isEmpty (String.trim query) then
                        "Type to filter rooms, people, and actions"

                    else
                        "No matching command"

        indexed =
            List.indexedMap Tuple.pair matched

        groups =
            [ Switcher.Rooms, Switcher.DMs, Switcher.Actions ]
                |> List.map (\s -> ( s, List.filter (\( _, m ) -> m.entry.section == s) indexed ))
                |> List.filter (\( _, items ) -> not (List.isEmpty items))
    in
    div [ class "onyx-spotlight", attribute "role" "presentation" ]
        [ div
            [ class "onyx-spotlight-backdrop"
            , attribute "aria-hidden" "true"
            , attribute "data-testid" "palette-backdrop"
            , onClick PaletteClose
            ]
            []
        , div
            [ class "onyx-spotlight-panel"
            , attribute "role" "dialog"
            , attribute "aria-modal" "true"
            , attribute "aria-label" "Command palette"
            , attribute "data-shortcut-scope" "palette"
            , attribute "data-testid" "command-palette"
            , attribute "tabindex" "-1"
            ]
            [ div [ class "onyx-spotlight-search" ]
                [ span [ class "onyx-spotlight-sigil", attribute "aria-hidden" "true" ] []
                , input
                    ([ id "onyx-spotlight-input"
                     , class "onyx-spotlight-input"
                     , attribute "role" "combobox"
                     , type_ "text"
                     , value query
                     , attribute "autocomplete" "off"
                     , attribute "spellcheck" "false"
                     , attribute "aria-label" "Command search"
                     , attribute "aria-describedby" "onyx-spotlight-status"
                     , attribute "aria-autocomplete" "list"
                     , attribute "aria-expanded" "true"
                     , attribute "aria-controls" listboxId
                     , attribute "data-onyx-autofocus" "palette"
                     , placeholder "Search rooms, people, and actions"
                     , onInput PaletteInput
                     , preventDefaultOn "keydown" comboKeys
                     ]
                        ++ (case Switcher.activeOptionId count active of
                                Just optId ->
                                    [ attribute "aria-activedescendant" optId ]

                                Nothing ->
                                    []
                           )
                    )
                    []
                , button
                    [ type_ "button"
                    , class "onyx-spotlight-close"
                    , attribute "aria-label" "Close spotlight"
                    , onClick PaletteClose
                    ]
                    [ span [ class "onyx-sheet-x", attribute "aria-hidden" "true" ] [] ]
                ]
            , -- The input's description for screen readers; the
              -- highlight already shows it, so it is visually hidden.
              p [ class "onyx-spotlight-status sr-only", id "onyx-spotlight-status" ] [ text activeHint ]
            , div
                [ id listboxId
                , class "onyx-spotlight-results"
                , attribute "role" "listbox"
                , attribute "aria-label" "Commands"
                ]
                (if List.isEmpty groups then
                    [ div [ class "onyx-spotlight-empty" ]
                        [ span [ class "onyx-spotlight-empty-text" ] [ text "Nothing surfaces yet" ]
                        , span [ class "onyx-spotlight-empty-sub" ] [ text "Try a room, a name, or an action" ]
                        ]
                    ]

                 else
                    List.map (groupView active) groups
                )
            , p [ class "onyx-spotlight-foot", attribute "aria-hidden" "true" ]
                [ kbd [] [ text "↑" ], kbd [] [ text "↓" ], text " move · ", kbd [] [ text "Enter" ], text " open · ", kbd [] [ text "Esc" ], text " close" ]
            , span [ class "sr-only", attribute "role" "status" ]
                [ text (Switcher.resultsAnnouncement query count) ]
            ]
        ]


groupView : Int -> ( Switcher.Section, List ( Int, Switcher.Matched ) ) -> Html Msg
groupView active ( section, items ) =
    div
        [ class "onyx-spotlight-group"
        , attribute "role" "group"
        , attribute "aria-label" (Switcher.sectionLabel section)
        , attribute "data-section" (Switcher.sectionLabel section)
        ]
        (span [ class "onyx-spotlight-section", attribute "aria-hidden" "true" ] [ text (Switcher.sectionLabel section) ]
            :: List.map (optionView active section) items
        )


optionView : Int -> Switcher.Section -> ( Int, Switcher.Matched ) -> Html Msg
optionView active section ( index, matched ) =
    div
        [ id (Switcher.optionId index)
        , class "onyx-spotlight-option"
        , attribute "role" "option"
        , attribute "aria-selected"
            (if index == active then
                "true"

             else
                "false"
            )
        , on "mousemove" (Decode.succeed (PaletteHover index))
        , preventDefaultOn "mousedown" (Decode.succeed ( PaletteHover index, True ))
        , onClick (PaletteRun index)
        ]
        ([ span
            [ class "onyx-spotlight-icon"
            , attribute "data-icon" (String.toLower (Switcher.sectionLabel section))
            , attribute "aria-hidden" "true"
            ]
            []
         , span [ class "onyx-spotlight-title" ]
            (List.map
                (\( chunk, hit ) ->
                    if hit then
                        mark [] [ text chunk ]

                    else
                        span [] [ text chunk ]
                )
                (Switcher.segments matched.entry.title matched.ranges)
            )
         ]
            ++ (if String.isEmpty matched.entry.hint then
                    []

                else
                    [ span [ class "onyx-spotlight-hint" ] [ text matched.entry.hint ] ]
               )
        )


{-| ↑/↓ move (wrapping), Enter runs, Escape closes — each claims the
key; anything else (and IME composition) passes through. -}
comboKeys : Decode.Decoder ( Msg, Bool )
comboKeys =
    Decode.map3 (\key composing code -> ( key, composing || code == 229 ))
        (Decode.field "key" Decode.string)
        (Decode.oneOf [ Decode.field "isComposing" Decode.bool, Decode.succeed False ])
        (Decode.oneOf [ Decode.field "keyCode" Decode.int, Decode.succeed 0 ])
        |> Decode.andThen
            (\( key, composing ) ->
                if composing then
                    Decode.fail "composing"

                else
                    case key of
                        "ArrowDown" ->
                            Decode.succeed ( PaletteMove 1, True )

                        "ArrowUp" ->
                            Decode.succeed ( PaletteMove -1, True )

                        "Enter" ->
                            Decode.succeed ( PaletteSubmit, True )

                        "Escape" ->
                            Decode.succeed ( PaletteClose, True )

                        _ ->
                            Decode.fail "pass"
            )


{-| Keyboard-shortcuts help (oracle `ShortcutsOverlay` copy, ids and
test ids); Escape arrives through the global `shortcut` port. -}
shortcutsOverlay : Model -> Html Msg
shortcutsOverlay model =
    if model.shortcutsOpen then
        Sheet.view
            { scope = "shortcuts"
            , label = Sheet.LabelledBy "shortcuts-overlay-title"
            , onClose = ShortcutsClose
            , placement = Sheet.Center
            , layerClass = "onyx-shortcuts"
            , panelClass = "onyx-shortcuts-sheet"
            , backdropClass = "onyx-shortcuts-backdrop"
            , layerAttrs = []
            , modal = True
            , attrs = [ attribute "aria-describedby" "shortcuts-overlay-description" ]
            }
                [ Sheet.headerWith
                    (Sheet.head { scope = "shortcuts", title = "Keyboard shortcuts", closeLabel = "Close keyboard shortcuts", onClose = ShortcutsClose }
                        |> (\h ->
                                { h
                                    | titleId = Just "shortcuts-overlay-title"
                                    , subtitle = Just "A quick reference for moving through Onyx without leaving the keyboard."
                                    , subtitleId = Just "shortcuts-overlay-description"
                                    , closeAttrs = [ attribute "data-onyx-autofocus" "shortcuts" ]
                                }
                           )
                    )
                , div [ class "shortcuts-overlay", attribute "data-testid" "shortcuts-overlay" ]
                    (List.map groupSection Switcher.shortcutGroups)
                ]

    else
        text ""


groupSection : Switcher.ShortcutGroup -> Html Msg
groupSection group =
    section
        [ class "shortcuts-overlay__group"
        , attribute "aria-labelledby" (Switcher.groupHeadingId group.group)
        ]
        [ h3 [ id (Switcher.groupHeadingId group.group), class "shortcuts-overlay__group-name" ] [ text group.group ]
        , div
            [ class "shortcuts-overlay__rows"
            , attribute "role" "list"
            , attribute "aria-label" (group.group ++ " shortcuts")
            ]
            (List.map
                (\row ->
                    div [ class "shortcuts-overlay__row", attribute "role" "listitem" ]
                        [ span [ class "shortcuts-overlay__desc" ] [ text row.description ]
                        , span [ class "shortcuts-overlay__keys" ]
                            (List.indexedMap
                                (\i chord ->
                                    (if i > 0 then
                                        [ span [ class "shortcuts-overlay__sep", attribute "aria-hidden" "true" ] [ text "or" ] ]

                                     else
                                        []
                                    )
                                        ++ [ kbd [ class "shortcuts-overlay__kbd" ] [ text chord ] ]
                                )
                                row.chords
                                |> List.concat
                            )
                        ]
                )
                group.rows
            )
        ]
