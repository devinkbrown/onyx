module AvatarTest exposing (suite)

{-| Oracle-mirrored vectors for identity avatars (mirroring
`src/primitives/Avatar.test.tsx`: initials, accessible labels,
size/service/owner classes, deterministic swatches, and the
exact service-name gate with near-name rejects).
-}

import Avatar exposing (..)
import Expect
import Html
import Html.Attributes as Attr
import Test exposing (Test, describe, test)
import Test.Html.Query as Query
import Test.Html.Selector as Selector


query : Html.Html msg -> Query.Single msg
query node =
    Html.div [] [ node ] |> Query.fromHtml


suite : Test
suite =
    describe "Avatar"
        [ test "renders initials and an accessible image label" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "AL" (initials "Ada Lovelace")
                    , \_ ->
                        query (view { name = "Ada Lovelace", owner = False, size = Md, extraClass = "", hidden = False })
                            |> Query.has
                                [ Selector.attribute (Attr.attribute "role" "img")
                                , Selector.attribute (Attr.attribute "aria-label" "Ada Lovelace")
                                , Selector.class "onyx-avatar--md"
                                ]
                    , \_ ->
                        query (view { name = "Ada Lovelace", owner = False, size = Md, extraClass = "", hidden = False })
                            |> Query.hasNot [ Selector.class "onyx-avatar--service" ]
                    ]
                    ()
        , test "hashes names exactly like the oracle accumulator" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal 3416080523 (hashName "Ada Lovelace")
                    , \_ -> Expect.equal 970719558 (hashName "Onyx Operator")
                    , \_ -> Expect.equal 92903040 (hashName "alice")
                    , \_ -> Expect.equal 0 (hashName "")
                    ]
                    ()
        , test "picks deterministic swatches off the hash" <|
            \_ ->
                let
                    expected =
                        ( "linear-gradient(135deg, var(--ink), var(--stone-3))", "var(--paper-dim)" )
                in
                Expect.all
                    [ \_ -> Expect.equal expected (swatch "Ada Lovelace")
                    , \_ -> Expect.equal expected (swatch "Onyx Operator")
                    , \_ -> Expect.equal (swatch "Onyx Operator") (swatch "Onyx Operator")
                    , \_ ->
                        Expect.equal
                            ( "linear-gradient(135deg, var(--lapis-deep), var(--stone-3))", "var(--paper)" )
                            (swatch "alice")
                    ]
                    ()
        , test "adds owner status to the accessible name and ring class" <|
            \_ ->
                query (view { name = "Root User", owner = True, size = Md, extraClass = "", hidden = False })
                    |> Query.has
                        [ Selector.attribute (Attr.attribute "aria-label" "Root User, owner")
                        , Selector.class "onyx-avatar--owner"
                        ]
        , test "renders OnyxOS as a first-party service (case-insensitive)" <|
            \_ ->
                let
                    names =
                        [ "OnyxOS", "onyxos", "ONYXOS", "  OnyxOs  " ]
                in
                Expect.all
                    (List.map
                        (\name ->
                            \_ ->
                                Expect.all
                                    [ \_ -> Expect.equal True (isServiceName name)
                                    , \_ -> Expect.equal "OnyxOS, Onyx service" (ariaLabel name False)
                                    , \_ ->
                                        query (view { name = name, owner = False, size = Sm, extraClass = "", hidden = False })
                                            |> Query.has
                                                [ Selector.attribute (Attr.attribute "aria-label" "OnyxOS, Onyx service")
                                                , Selector.class "onyx-avatar--service"
                                                , Selector.class "onyx-avatar--sm"
                                                ]
                                    , \_ ->
                                        query (view { name = name, owner = False, size = Sm, extraClass = "", hidden = False })
                                            |> Query.hasNot [ Selector.text "ON" ]
                                    ]
                                    ()
                        )
                        names
                    )
                    ()
        , test "includes owner wording on the service accessible name" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "OnyxOS, Onyx service, owner" (ariaLabel "OnyxOS" True)
                    , \_ ->
                        query (view { name = "OnyxOS", owner = True, size = Md, extraClass = "", hidden = False })
                            |> Query.has [ Selector.class "onyx-avatar--service", Selector.class "onyx-avatar--owner" ]
                    ]
                    ()
        , test "does not treat near-names as the service" <|
            \_ ->
                let
                    cases =
                        [ ( "Announce", "AN" )
                        , ( "OnyxOSBot", "ON" )
                        , ( "Onyx OS", "OO" )
                        , ( "Bot", "BO" )
                        ]
                in
                Expect.all
                    (List.map
                        (\( name, mark ) ->
                            \_ ->
                                Expect.all
                                    [ \_ -> Expect.equal False (isServiceName name)
                                    , \_ -> Expect.equal mark (initials name)
                                    , \_ -> Expect.equal name (ariaLabel name False)
                                    , \_ ->
                                        query (view { name = name, owner = False, size = Md, extraClass = "", hidden = False })
                                            |> Query.hasNot [ Selector.class "onyx-avatar--service" ]
                                    ]
                                    ()
                        )
                        cases
                    )
                    ()
        , test "tints walk the cyan-azure band with the signed lightness arm" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "hsl(200 74% 74%)" (nickTint "alice")
                    , \_ -> Expect.equal "hsl(189 63% 63%)" (nickTint "Ada Lovelace")
                    , \_ -> Expect.equal "hsl(216 74% 69%)" (nickTint "me")
                    , \_ -> Expect.equal "hsl(199 61% 74%)" (nickTint "bob")
                    , \_ -> Expect.equal "hsl(188 76% 62%)" (nickTint "OnyxOS")
                    , \_ -> Expect.equal "hsl(214 68% 69%)" (nickTint "x")
                    , \_ -> Expect.equal (nickTint "alice") (nickTint "alice")
                    ]
                    ()
        , test "single words, blanks, and multi-word names initial correctly" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "?" (initials "")
                    , \_ -> Expect.equal "?" (initials "   ")
                    , \_ -> Expect.equal "A" (initials "a")
                    , \_ -> Expect.equal "AL" (initials "alice")
                    , \_ -> Expect.equal "OO" (initials "Onyx Operator")
                    ]
                    ()
        ]
