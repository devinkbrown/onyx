module Avatar exposing
    ( Size(..)
    , hashName
    , initials
    , isServiceName
    , ariaLabel
    , swatch
    , swatches
    , view
    )

{-| Deterministic identity avatars (mirroring
`src/primitives/Avatar.tsx`: the unsigned-32 hash picks one of
five gradient swatches, names render as one- or two-letter
initials, and the exact first-party service name renders the
service mark).

Narrowings: the service mark needs real SVG (`elm/svg`), which
is not vendored — a service avatar keeps the exact accessible
name and `--service` class but renders empty content instead of
the decorative mark. Astral-plane names hash by code point
where the oracle hashes UTF-16 code units, so emoji-led names
may land on a different swatch.
-}

import Bitwise
import Html exposing (Html, div, span, text)
import Html.Attributes exposing (attribute, class, style)


{-| Avatar sizes (mirroring the `size` prop). -}
type Size
    = Sm
    | Md


{-| Gradient swatches (verbatim copy, order significant). -}
swatches : List ( String, String )
swatches =
    [ ( "linear-gradient(135deg, var(--lapis-deep), var(--stone-3))", "var(--paper)" )
    , ( "linear-gradient(135deg, var(--stone-3), var(--stone-2))", "var(--lapis-bright)" )
    , ( "linear-gradient(135deg, var(--stone-2), var(--lapis-deep))", "var(--paper)" )
    , ( "linear-gradient(135deg, var(--ink), var(--stone-3))", "var(--paper-dim)" )
    , ( "linear-gradient(135deg, var(--stone), var(--stone-2))", "var(--paper)" )
    ]


{-| Unsigned-32 name hash (mirroring `hashName`: `hash * 31 +
code` with `>>> 0` after every step, so intermediate values
never exceed 2^37 and stay exact; the final value is always
non-negative, exactly like the oracle accumulator).
-}
hashName : String -> Int
hashName name =
    String.foldl
        (\c acc -> Bitwise.shiftRightZfBy 0 (acc * 31 + Char.toCode c))
        0
        name


{-| Swatch for a name (mirroring the `hash % length` pick). -}
swatch : String -> ( String, String )
swatch name =
    case swatches of
        [] ->
            ( "", "" )

        first :: _ ->
            List.drop (modBy (List.length swatches) (hashName name)) swatches
                |> List.head
                |> Maybe.withDefault first


{-| Initials (mirroring `initials`: whitespace-split words with
empties filtered — `String.words` alone keeps a lone empty word
for blank input where the oracle `filter(Boolean)` drops it — no
words renders `?`, one word renders its first two letters,
otherwise the first and last initials, all uppercased).
-}
initials : String -> String
initials name =
    case List.filter (not << String.isEmpty) (String.words name) of
        [] ->
            "?"

        [ only ] ->
            String.toUpper (String.left 2 only)

        first :: rest ->
            let
                last =
                    List.foldl (\word _ -> word) first rest
            in
            String.toUpper (String.left 1 first ++ String.left 1 last)


{-| Exact first-party service identity only (mirroring
`isOnyxOsService`: trimmed, case-insensitive, no bots or
near-names).
-}
isServiceName : String -> Bool
isServiceName name =
    String.toLower (String.trim name) == "onyxos"


{-| Accessible image label (mirroring `ariaLabel`). -}
ariaLabel : String -> Bool -> String
ariaLabel name owner =
    if isServiceName name then
        if owner then
            "OnyxOS, Onyx service, owner"

        else
            "OnyxOS, Onyx service"

    else if owner then
        name ++ ", owner"

    else
        name


{-| Render an avatar. `extraClass` merges like the oracle class
prop; `hidden` passes `aria-hidden` through for decorative
placements (roster rows, the member card).
-}
view : { name : String, owner : Bool, size : Size, extraClass : String, hidden : Bool } -> Html msg
view config =
    let
        service =
            isServiceName config.name

        sizeClass =
            case config.size of
                Sm ->
                    "onyx-avatar--sm"

                Md ->
                    "onyx-avatar--md"

        classes =
            String.join " "
                (List.filter (\part -> part /= "")
                    [ "onyx-avatar"
                    , sizeClass
                    , if service then
                        "onyx-avatar--service"

                      else
                        ""
                    , if config.owner then
                        "onyx-avatar--owner"

                      else
                        ""
                    , config.extraClass
                    ]
                )

        ( bg, fg ) =
            swatch config.name

        baseAttrs =
            [ class classes
            , attribute "role" "img"
            , attribute "aria-label" (ariaLabel config.name config.owner)
            ]
                ++ (if config.hidden then
                        [ attribute "aria-hidden" "true" ]

                    else
                        []
                   )
                ++ (if service then
                        []

                    else
                        [ style "--onyx-avatar-bg" bg
                        , style "--onyx-avatar-fg" fg
                        ]
                   )
    in
    div baseAttrs
        [ if service then
            -- No elm/svg vendored: the decorative mark stays out
            -- while the accessible name and service class hold.
            span [ attribute "aria-hidden" "true" ] []

          else
            span [] [ text (initials config.name) ]
        ]
