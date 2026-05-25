'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useOnyxStore } from '@/lib/store';

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  onClose: () => void;
}

interface EmojiEntry {
  e: string;
  n: string;
}

interface CategoryDef {
  id: string;
  label: string;
  icon: string;
  emoji: EmojiEntry[];
}

// ── Skin tone modifiers ──────────────────────────────────────────────────────
const SKIN_TONES = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'];
const SKIN_TONE_LABELS = ['Default', 'Light', 'Medium-Light', 'Medium', 'Medium-Dark', 'Dark'];
const SKIN_TONE_SWATCHES = ['#FFCC22', '#FDDBB4', '#EAB88A', '#C68642', '#8D5524', '#3D2B1F'];

const SKIN_TONE_CAPABLE = new Set([
  '👋','🤚','🖐','✋','🖖','🤙','👈','👉','👆','🖕','👇','☝','👍','👎','✊','👊','🤛','🤜','🤞','✌','🤟','🤘','👌','🤌','🤏','👐','🙌','👏','🤲','🙏','✍','💅','🤳','💪','🦵','🦶','👂','🦻','👃','🦴','👁','👀','👅','👄','👶','🧒','👦','👧','🧑','👱','👨','🧔','👩','👴','👵','🧓','👮','👷','💂','🕵','🧑','👨','👩','🏋','🤼','🤸','⛹','🤺','🏇','🧘','🏄','🏊','🤽','🚣','🧗','🚵','🚴','🏌','🏂','⛷',
]);

// ── Emoji aliases ────────────────────────────────────────────────────────────
const EMOJI_ALIASES: Record<string, string> = {
  '+1': '👍', 'thumbsup': '👍', 'like': '👍',
  '-1': '👎', 'thumbsdown': '👎',
  'lol': '😂', 'rofl': '🤣',
  'heart': '❤️', 'love': '❤️',
  'fire': '🔥', 'hot': '🔥',
  'tada': '🎉', 'party': '🎉',
  'wave': '👋', 'hi': '👋',
  'pray': '🙏', 'thanks': '🙏',
  'ok': '👌', 'check': '✅',
  'x': '❌', 'no': '❌',
  'star': '⭐', 'sparkles': '✨',
  'rocket': '🚀', 'zap': '⚡',
  'eyes': '👀', 'see': '👀',
  'shrug': '🤷', 'idk': '🤷',
  'facepalm': '🤦', 'fml': '🤦',
  'muscle': '💪', 'strong': '💪',
  'clap': '👏', 'bravo': '👏',
  'skull': '💀', 'rip': '💀',
  'bug': '🐛', 'fix': '🔧',
  'lock': '🔒', 'security': '🔒',
  'key': '🔑', 'password': '🔑',
  'idea': '💡', 'light': '💡',
  'trophy': '🏆', 'win': '🏆', 'winner': '🏆',
  'gift': '🎁', 'present': '🎁',
  'coffee': '☕', 'cafe': '☕',
  'beer': '🍺', 'cheers': '🍺',
  'pizza': '🍕', 'food': '🍕',
  'game': '🎮', 'controller': '🎮',
  'camera': '📸', 'photo': '📸',
  'music': '🎵', 'song': '🎵',
  'sleep': '😴', 'zzz': '😴',
  'angry': '😡', 'rage': '😡',
  'cry': '😭', 'sad': '😭',
  'laugh': '😂', 'funny': '😂',
  'cool': '😎', 'sunglasses': '😎',
  'think': '🤔', 'hmm': '🤔',
};

const EMOJI_TO_ALIASES: Record<string, string[]> = {};
for (const [alias, emoji] of Object.entries(EMOJI_ALIASES)) {
  if (!EMOJI_TO_ALIASES[emoji]) EMOJI_TO_ALIASES[emoji] = [];
  EMOJI_TO_ALIASES[emoji].push(alias);
}

// ── Emoji data ───────────────────────────────────────────────────────────────
const CATEGORIES: CategoryDef[] = [
  {
    id: 'smileys',
    label: 'Smileys & People',
    icon: '😀',
    emoji: [
      {e:'😀',n:'grinning face'},{e:'😃',n:'grinning face with big eyes'},{e:'😄',n:'grinning face with smiling eyes'},{e:'😁',n:'beaming face with smiling eyes'},{e:'😆',n:'grinning squinting face'},{e:'😅',n:'grinning face with sweat'},{e:'🤣',n:'rolling on the floor laughing'},{e:'😂',n:'face with tears of joy'},{e:'🙂',n:'slightly smiling face'},{e:'😊',n:'smiling face with smiling eyes'},{e:'😇',n:'smiling face with halo'},{e:'🥰',n:'smiling face with hearts'},{e:'😍',n:'smiling face with heart eyes'},{e:'🤩',n:'star-struck'},{e:'😘',n:'face blowing a kiss'},{e:'😗',n:'kissing face'},{e:'☺️',n:'smiling face'},{e:'😚',n:'kissing face with closed eyes'},{e:'😙',n:'kissing face with smiling eyes'},{e:'🥲',n:'smiling face with tear'},{e:'😋',n:'face savoring food'},{e:'😛',n:'face with tongue'},{e:'😜',n:'winking face with tongue'},{e:'🤪',n:'zany face'},{e:'😝',n:'squinting face with tongue'},{e:'🤑',n:'money-mouth face'},{e:'🤗',n:'hugging face'},{e:'🤭',n:'face with hand over mouth'},{e:'🤫',n:'shushing face'},{e:'🤔',n:'thinking face'},{e:'🤐',n:'zipper-mouth face'},{e:'🤨',n:'face with raised eyebrow'},{e:'😐',n:'neutral face'},{e:'😑',n:'expressionless face'},{e:'😶',n:'face without mouth'},{e:'😏',n:'smirking face'},{e:'😒',n:'unamused face'},{e:'🙄',n:'face with rolling eyes'},{e:'😬',n:'grimacing face'},{e:'🤥',n:'lying face'},{e:'😌',n:'relieved face'},{e:'😔',n:'pensive face'},{e:'😪',n:'sleepy face'},{e:'🤤',n:'drooling face'},{e:'😴',n:'sleeping face'},{e:'😷',n:'face with medical mask'},{e:'🤒',n:'face with thermometer'},{e:'🤕',n:'face with head-bandage'},{e:'🤢',n:'nauseated face'},{e:'🤮',n:'face vomiting'},{e:'🤧',n:'sneezing face'},{e:'🥵',n:'hot face'},{e:'🥶',n:'cold face'},{e:'🥴',n:'woozy face'},{e:'😵',n:'dizzy face'},{e:'💫',n:'dizzy'},{e:'🤯',n:'exploding head'},{e:'🤠',n:'cowboy hat face'},{e:'🥳',n:'partying face'},{e:'🥸',n:'disguised face'},{e:'😎',n:'smiling face with sunglasses'},{e:'🤓',n:'nerd face'},{e:'🧐',n:'face with monocle'},{e:'😕',n:'confused face'},{e:'😟',n:'worried face'},{e:'🙁',n:'slightly frowning face'},{e:'☹️',n:'frowning face'},{e:'😮',n:'face with open mouth'},{e:'😯',n:'hushed face'},{e:'😲',n:'astonished face'},{e:'😳',n:'flushed face'},{e:'🥺',n:'pleading face'},{e:'😦',n:'frowning face with open mouth'},{e:'😧',n:'anguished face'},{e:'😨',n:'fearful face'},{e:'😰',n:'anxious face with sweat'},{e:'😥',n:'sad but relieved face'},{e:'😢',n:'crying face'},{e:'😭',n:'loudly crying face'},{e:'😱',n:'face screaming in fear'},{e:'😖',n:'confounded face'},{e:'😣',n:'persevering face'},{e:'😞',n:'disappointed face'},{e:'😓',n:'downcast face with sweat'},{e:'😩',n:'weary face'},{e:'😫',n:'tired face'},{e:'🥱',n:'yawning face'},{e:'😤',n:'face with steam from nose'},{e:'😡',n:'pouting face'},{e:'😠',n:'angry face'},{e:'🤬',n:'face with symbols on mouth'},{e:'😈',n:'smiling face with horns'},{e:'👿',n:'angry face with horns'},{e:'💀',n:'skull'},{e:'☠️',n:'skull and crossbones'},{e:'💩',n:'pile of poo'},{e:'🤡',n:'clown face'},{e:'👹',n:'ogre'},{e:'👺',n:'goblin'},{e:'👻',n:'ghost'},{e:'👽',n:'alien'},{e:'👾',n:'alien monster'},{e:'🤖',n:'robot'},{e:'😺',n:'grinning cat'},{e:'😸',n:'grinning cat with smiling eyes'},{e:'😹',n:'cat with tears of joy'},{e:'😻',n:'smiling cat with heart eyes'},{e:'😼',n:'cat with wry smile'},{e:'😽',n:'kissing cat'},{e:'🙀',n:'weary cat'},{e:'😿',n:'crying cat'},{e:'😾',n:'pouting cat'},{e:'🙈',n:'see-no-evil monkey'},{e:'🙉',n:'hear-no-evil monkey'},{e:'🙊',n:'speak-no-evil monkey'},{e:'💋',n:'kiss mark'},{e:'💌',n:'love letter'},{e:'💘',n:'heart with arrow'},{e:'💝',n:'heart with ribbon'},{e:'💖',n:'sparkling heart'},{e:'💗',n:'growing heart'},{e:'💓',n:'beating heart'},{e:'💞',n:'revolving hearts'},{e:'💕',n:'two hearts'},{e:'💟',n:'heart decoration'},{e:'❣️',n:'heart exclamation'},{e:'💔',n:'broken heart'},{e:'❤️',n:'red heart'},{e:'🧡',n:'orange heart'},{e:'💛',n:'yellow heart'},{e:'💚',n:'green heart'},{e:'💙',n:'blue heart'},{e:'💜',n:'purple heart'},{e:'🤎',n:'brown heart'},{e:'🖤',n:'black heart'},{e:'🤍',n:'white heart'},{e:'💯',n:'hundred points'},{e:'💢',n:'anger symbol'},{e:'💥',n:'collision'},{e:'💦',n:'sweat droplets'},{e:'💨',n:'dashing away'},{e:'💤',n:'zzz'},{e:'💬',n:'speech bubble'},{e:'💭',n:'thought balloon'},{e:'🗯️',n:'right anger bubble'},{e:'👋',n:'waving hand'},{e:'🤚',n:'raised back of hand'},{e:'🖐️',n:'hand with fingers splayed'},{e:'✋',n:'raised hand'},{e:'🖖',n:'vulcan salute'},{e:'🤙',n:'call me hand'},{e:'👈',n:'backhand index pointing left'},{e:'👉',n:'backhand index pointing right'},{e:'👆',n:'backhand index pointing up'},{e:'🖕',n:'middle finger'},{e:'👇',n:'backhand index pointing down'},{e:'☝️',n:'index pointing up'},{e:'👍',n:'thumbs up'},{e:'👎',n:'thumbs down'},{e:'✊',n:'raised fist'},{e:'👊',n:'oncoming fist'},{e:'🤛',n:'left-facing fist'},{e:'🤜',n:'right-facing fist'},{e:'🤞',n:'crossed fingers'},{e:'✌️',n:'victory hand'},{e:'🤟',n:'love-you gesture'},{e:'🤘',n:'sign of the horns'},{e:'👌',n:'ok hand'},{e:'🤌',n:'pinched fingers'},{e:'🤏',n:'pinching hand'},{e:'👐',n:'open hands'},{e:'🙌',n:'raising hands'},{e:'👏',n:'clapping hands'},{e:'🤲',n:'palms up together'},{e:'🙏',n:'folded hands'},{e:'🫶',n:'heart hands'},{e:'🫂',n:'people hugging'},{e:'💪',n:'flexed biceps'},{e:'🦾',n:'mechanical arm'},{e:'🦿',n:'mechanical leg'},{e:'🦵',n:'leg'},{e:'🦶',n:'foot'},{e:'👂',n:'ear'},{e:'🦻',n:'ear with hearing aid'},{e:'👃',n:'nose'},{e:'🧠',n:'brain'},{e:'🫀',n:'anatomical heart'},{e:'🫁',n:'lungs'},{e:'🦷',n:'tooth'},{e:'🦴',n:'bone'},{e:'👁️',n:'eye'},{e:'👀',n:'eyes'},{e:'🫦',n:'biting lip'},{e:'👅',n:'tongue'},{e:'👶',n:'baby'},{e:'🧒',n:'child'},{e:'👦',n:'boy'},{e:'👧',n:'girl'},{e:'🧑',n:'person'},{e:'👱',n:'person blond hair'},{e:'👨',n:'man'},{e:'👩',n:'woman'},{e:'👴',n:'old man'},{e:'👵',n:'old woman'},{e:'🧓',n:'older person'},
    ],
  },
  {
    id: 'animals',
    label: 'Animals & Nature',
    icon: '🐾',
    emoji: [
      {e:'🐶',n:'dog face'},{e:'🐱',n:'cat face'},{e:'🐭',n:'mouse face'},{e:'🐹',n:'hamster'},{e:'🐰',n:'rabbit face'},{e:'🦊',n:'fox'},{e:'🐻',n:'bear'},{e:'🐼',n:'panda'},{e:'🐨',n:'koala'},{e:'🐯',n:'tiger face'},{e:'🦁',n:'lion'},{e:'🐮',n:'cow face'},{e:'🐷',n:'pig face'},{e:'🐸',n:'frog'},{e:'🐵',n:'monkey face'},{e:'🐔',n:'chicken'},{e:'🐧',n:'penguin'},{e:'🐦',n:'bird'},{e:'🐤',n:'baby chick'},{e:'🦆',n:'duck'},{e:'🦅',n:'eagle'},{e:'🦉',n:'owl'},{e:'🦇',n:'bat'},{e:'🐺',n:'wolf'},{e:'🐗',n:'boar'},{e:'🐴',n:'horse face'},{e:'🦄',n:'unicorn'},{e:'🐝',n:'honeybee'},{e:'🪱',n:'worm'},{e:'🐛',n:'bug'},{e:'🦋',n:'butterfly'},{e:'🐌',n:'snail'},{e:'🐞',n:'lady beetle'},{e:'🐜',n:'ant'},{e:'🦟',n:'mosquito'},{e:'🦗',n:'cricket'},{e:'🕷️',n:'spider'},{e:'🦂',n:'scorpion'},{e:'🐢',n:'turtle'},{e:'🐍',n:'snake'},{e:'🦎',n:'lizard'},{e:'🦕',n:'sauropod'},{e:'🦖',n:'t-rex'},{e:'🐙',n:'octopus'},{e:'🦑',n:'squid'},{e:'🦐',n:'shrimp'},{e:'🦞',n:'lobster'},{e:'🦀',n:'crab'},{e:'🐡',n:'blowfish'},{e:'🐠',n:'tropical fish'},{e:'🐟',n:'fish'},{e:'🐬',n:'dolphin'},{e:'🐳',n:'spouting whale'},{e:'🐋',n:'whale'},{e:'🦈',n:'shark'},{e:'🐊',n:'crocodile'},{e:'🐅',n:'tiger'},{e:'🐆',n:'leopard'},{e:'🦓',n:'zebra'},{e:'🦍',n:'gorilla'},{e:'🦧',n:'orangutan'},{e:'🦣',n:'mammoth'},{e:'🐘',n:'elephant'},{e:'🦛',n:'hippopotamus'},{e:'🦏',n:'rhinoceros'},{e:'🐪',n:'camel'},{e:'🐫',n:'two-hump camel'},{e:'🦒',n:'giraffe'},{e:'🦘',n:'kangaroo'},{e:'🦬',n:'bison'},{e:'🐃',n:'water buffalo'},{e:'🐂',n:'ox'},{e:'🐄',n:'cow'},{e:'🐎',n:'horse'},{e:'🐖',n:'pig'},{e:'🐏',n:'ram'},{e:'🐑',n:'ewe'},{e:'🦙',n:'llama'},{e:'🐐',n:'goat'},{e:'🦌',n:'deer'},{e:'🐕',n:'dog'},{e:'🐩',n:'poodle'},{e:'🦮',n:'guide dog'},{e:'🐕‍🦺',n:'service dog'},{e:'🐈',n:'cat'},{e:'🐈‍⬛',n:'black cat'},{e:'🪶',n:'feather'},{e:'🐓',n:'rooster'},{e:'🦃',n:'turkey'},{e:'🦤',n:'dodo'},{e:'🦚',n:'peacock'},{e:'🦜',n:'parrot'},{e:'🦢',n:'swan'},{e:'🦩',n:'flamingo'},{e:'🕊️',n:'dove'},{e:'🐇',n:'rabbit'},{e:'🦝',n:'raccoon'},{e:'🦨',n:'skunk'},{e:'🦡',n:'badger'},{e:'🦦',n:'otter'},{e:'🦥',n:'sloth'},{e:'🐁',n:'mouse'},{e:'🐀',n:'rat'},{e:'🐿️',n:'chipmunk'},{e:'🦔',n:'hedgehog'},{e:'🌵',n:'cactus'},{e:'🎄',n:'christmas tree'},{e:'🌲',n:'evergreen tree'},{e:'🌳',n:'deciduous tree'},{e:'🌴',n:'palm tree'},{e:'🪵',n:'wood'},{e:'🌱',n:'seedling'},{e:'🌿',n:'herb'},{e:'☘️',n:'shamrock'},{e:'🍀',n:'four leaf clover'},{e:'🎍',n:'pine decoration'},{e:'🎋',n:'tanabata tree'},{e:'🍃',n:'leaf fluttering in wind'},{e:'🍂',n:'fallen leaf'},{e:'🍁',n:'maple leaf'},{e:'🍄',n:'mushroom'},{e:'🐚',n:'spiral shell'},{e:'🪸',n:'coral'},{e:'🌾',n:'sheaf of rice'},{e:'💐',n:'bouquet'},{e:'🌷',n:'tulip'},{e:'🌹',n:'rose'},{e:'🥀',n:'wilted flower'},{e:'🌺',n:'hibiscus'},{e:'🌸',n:'cherry blossom'},{e:'🌼',n:'blossom'},{e:'🌻',n:'sunflower'},{e:'🌞',n:'sun with face'},{e:'🌝',n:'full moon face'},{e:'🌛',n:'first quarter moon face'},{e:'🌜',n:'last quarter moon face'},{e:'🌚',n:'new moon face'},{e:'🌕',n:'full moon'},{e:'🌙',n:'crescent moon'},{e:'🌟',n:'glowing star'},{e:'⭐',n:'star'},{e:'✨',n:'sparkles'},{e:'⚡',n:'lightning'},{e:'☄️',n:'comet'},{e:'💥',n:'collision'},{e:'🔥',n:'fire'},{e:'🌈',n:'rainbow'},{e:'☁️',n:'cloud'},{e:'⛅',n:'sun behind cloud'},{e:'❄️',n:'snowflake'},{e:'☃️',n:'snowman'},{e:'🌊',n:'water wave'},{e:'🌀',n:'cyclone'},
    ],
  },
  {
    id: 'food',
    label: 'Food & Drink',
    icon: '🍔',
    emoji: [
      {e:'🍎',n:'red apple'},{e:'🍊',n:'tangerine'},{e:'🍋',n:'lemon'},{e:'🍇',n:'grapes'},{e:'🍓',n:'strawberry'},{e:'🫐',n:'blueberries'},{e:'🍈',n:'melon'},{e:'🍑',n:'peach'},{e:'🍒',n:'cherries'},{e:'🍌',n:'banana'},{e:'🍉',n:'watermelon'},{e:'🍐',n:'pear'},{e:'🥭',n:'mango'},{e:'🍍',n:'pineapple'},{e:'🥥',n:'coconut'},{e:'🥝',n:'kiwi fruit'},{e:'🍅',n:'tomato'},{e:'🫒',n:'olive'},{e:'🥑',n:'avocado'},{e:'🍆',n:'eggplant'},{e:'🥦',n:'broccoli'},{e:'🥬',n:'leafy green'},{e:'🥒',n:'cucumber'},{e:'🌶️',n:'hot pepper'},{e:'🫑',n:'bell pepper'},{e:'🧄',n:'garlic'},{e:'🧅',n:'onion'},{e:'🥕',n:'carrot'},{e:'🌽',n:'ear of corn'},{e:'🫚',n:'jar'},{e:'🥚',n:'egg'},{e:'🍳',n:'cooking'},{e:'🥘',n:'shallow pan of food'},{e:'🍲',n:'pot of food'},{e:'🫕',n:'fondue'},{e:'🥗',n:'green salad'},{e:'🍿',n:'popcorn'},{e:'🧈',n:'butter'},{e:'🥫',n:'canned food'},{e:'🧀',n:'cheese wedge'},{e:'🍖',n:'meat on bone'},{e:'🍗',n:'poultry leg'},{e:'🥩',n:'cut of meat'},{e:'🥓',n:'bacon'},{e:'🌭',n:'hot dog'},{e:'🍔',n:'hamburger'},{e:'🍟',n:'french fries'},{e:'🍕',n:'pizza'},{e:'🫔',n:'tamale'},{e:'🌮',n:'taco'},{e:'🌯',n:'burrito'},{e:'🥙',n:'stuffed flatbread'},{e:'🧆',n:'falafel'},{e:'🥞',n:'pancakes'},{e:'🧇',n:'waffle'},{e:'🥐',n:'croissant'},{e:'🥖',n:'baguette bread'},{e:'🍞',n:'bread'},{e:'🥨',n:'pretzel'},{e:'🥯',n:'bagel'},{e:'🧁',n:'cupcake'},{e:'🍮',n:'custard'},{e:'🎂',n:'birthday cake'},{e:'🍰',n:'shortcake'},{e:'🍪',n:'cookie'},{e:'🍩',n:'doughnut'},{e:'🍨',n:'ice cream'},{e:'🍧',n:'shaved ice'},{e:'🍦',n:'soft ice cream'},{e:'🥧',n:'pie'},{e:'🍡',n:'dango'},{e:'🍢',n:'oden'},{e:'🍣',n:'sushi'},{e:'🍤',n:'fried shrimp'},{e:'🍙',n:'rice ball'},{e:'🍘',n:'rice cracker'},{e:'🍚',n:'cooked rice'},{e:'🍛',n:'curry rice'},{e:'🍜',n:'steaming bowl'},{e:'🍝',n:'spaghetti'},{e:'🍠',n:'roasted sweet potato'},{e:'🦪',n:'oyster'},{e:'🍱',n:'bento box'},{e:'🥡',n:'takeout box'},{e:'🍭',n:'lollipop'},{e:'🍬',n:'candy'},{e:'🍫',n:'chocolate bar'},{e:'🌰',n:'chestnut'},{e:'🥜',n:'peanuts'},{e:'🍯',n:'honey pot'},{e:'🧃',n:'beverage box'},{e:'🥤',n:'cup with straw'},{e:'🫖',n:'teapot'},{e:'☕',n:'hot beverage'},{e:'🍵',n:'teacup without handle'},{e:'🧋',n:'bubble tea'},{e:'🍺',n:'beer mug'},{e:'🍻',n:'clinking beer mugs'},{e:'🥂',n:'clinking glasses'},{e:'🍷',n:'wine glass'},{e:'🥃',n:'tumbler glass'},{e:'🍸',n:'cocktail glass'},{e:'🍹',n:'tropical drink'},{e:'🍾',n:'bottle with popping cork'},{e:'🍶',n:'sake'},{e:'🧊',n:'ice'},{e:'🥄',n:'spoon'},{e:'🍴',n:'fork and knife'},{e:'🍽️',n:'fork and knife with plate'},{e:'🥢',n:'chopsticks'},{e:'🧂',n:'salt'},
    ],
  },
  {
    id: 'travel',
    label: 'Travel & Places',
    icon: '✈️',
    emoji: [
      {e:'🚗',n:'automobile'},{e:'🚕',n:'taxi'},{e:'🚙',n:'sport utility vehicle'},{e:'🚌',n:'bus'},{e:'🚎',n:'trolleybus'},{e:'🏎️',n:'racing car'},{e:'🚓',n:'police car'},{e:'🚑',n:'ambulance'},{e:'🚒',n:'fire engine'},{e:'🚐',n:'minibus'},{e:'🛻',n:'pickup truck'},{e:'🚚',n:'delivery truck'},{e:'🚛',n:'articulated lorry'},{e:'🚜',n:'tractor'},{e:'🏍️',n:'motorcycle'},{e:'🛵',n:'motor scooter'},{e:'🛺',n:'auto rickshaw'},{e:'🚲',n:'bicycle'},{e:'🛴',n:'kick scooter'},{e:'🛹',n:'skateboard'},{e:'🛼',n:'roller skate'},{e:'🚏',n:'bus stop'},{e:'🛣️',n:'motorway'},{e:'🛤️',n:'railway track'},{e:'⛽',n:'fuel pump'},{e:'🚦',n:'vertical traffic light'},{e:'🚥',n:'horizontal traffic light'},{e:'🚧',n:'construction'},{e:'⚓',n:'anchor'},{e:'🛟',n:'ring buoy'},{e:'⛵',n:'sailboat'},{e:'🚤',n:'speedboat'},{e:'🛥️',n:'motor boat'},{e:'🛳️',n:'passenger ship'},{e:'⛴️',n:'ferry'},{e:'🚢',n:'ship'},{e:'✈️',n:'airplane'},{e:'🛩️',n:'small airplane'},{e:'🛫',n:'airplane departure'},{e:'🛬',n:'airplane arrival'},{e:'🛰️',n:'satellite'},{e:'🚀',n:'rocket'},{e:'🛸',n:'flying saucer'},{e:'🪂',n:'parachute'},{e:'💺',n:'seat'},{e:'🚁',n:'helicopter'},{e:'🚠',n:'mountain cableway'},{e:'🚡',n:'aerial tramway'},{e:'🚟',n:'suspension railway'},{e:'🚃',n:'railway car'},{e:'🚋',n:'tram car'},{e:'🚞',n:'mountain railway'},{e:'🚝',n:'monorail'},{e:'🚄',n:'high-speed train'},{e:'🚅',n:'bullet train'},{e:'🚈',n:'light rail'},{e:'🚂',n:'locomotive'},{e:'🚆',n:'train'},{e:'🚇',n:'metro'},{e:'🚊',n:'tram'},{e:'🚉',n:'station'},{e:'🌍',n:'globe showing europe-africa'},{e:'🌎',n:'globe showing americas'},{e:'🌏',n:'globe showing asia-australia'},{e:'🗺️',n:'world map'},{e:'🧭',n:'compass'},{e:'🏔️',n:'snow-capped mountain'},{e:'⛰️',n:'mountain'},{e:'🌋',n:'volcano'},{e:'🗻',n:'mount fuji'},{e:'🏕️',n:'camping'},{e:'🏖️',n:'beach with umbrella'},{e:'🏜️',n:'desert'},{e:'🏝️',n:'desert island'},{e:'🏞️',n:'national park'},{e:'🏟️',n:'stadium'},{e:'🏛️',n:'classical building'},{e:'🏗️',n:'building construction'},{e:'🏘️',n:'houses'},{e:'🏚️',n:'derelict house'},{e:'🏠',n:'house'},{e:'🏡',n:'house with garden'},{e:'🏢',n:'office building'},{e:'🏣',n:'japanese post office'},{e:'🏤',n:'post office'},{e:'🏥',n:'hospital'},{e:'🏦',n:'bank'},{e:'🏨',n:'hotel'},{e:'🏩',n:'love hotel'},{e:'🏪',n:'convenience store'},{e:'🏫',n:'school'},{e:'🏬',n:'department store'},{e:'🏭',n:'factory'},{e:'🏯',n:'japanese castle'},{e:'🏰',n:'european castle'},{e:'💒',n:'wedding'},{e:'⛪',n:'church'},{e:'🕌',n:'mosque'},{e:'🕍',n:'synagogue'},{e:'⛩️',n:'shinto shrine'},{e:'🕋',n:'kaaba'},{e:'⛲',n:'fountain'},{e:'⛺',n:'tent'},{e:'🌁',n:'foggy'},{e:'🌃',n:'night with stars'},{e:'🏙️',n:'cityscape'},{e:'🌄',n:'sunrise over mountains'},{e:'🌅',n:'sunrise'},{e:'🌆',n:'cityscape at dusk'},{e:'🌇',n:'sunset'},{e:'🌉',n:'bridge at night'},{e:'🗼',n:'tokyo tower'},{e:'🗽',n:'statue of liberty'},{e:'🗾',n:'map of japan'},{e:'🎑',n:'moon viewing ceremony'},
    ],
  },
  {
    id: 'activities',
    label: 'Activities',
    icon: '⚽',
    emoji: [
      {e:'⚽',n:'soccer ball'},{e:'🏀',n:'basketball'},{e:'🏈',n:'american football'},{e:'⚾',n:'baseball'},{e:'🥎',n:'softball'},{e:'🎾',n:'tennis'},{e:'🏐',n:'volleyball'},{e:'🏉',n:'rugby football'},{e:'🥏',n:'flying disc'},{e:'🎱',n:'pool 8 ball'},{e:'🏓',n:'ping pong'},{e:'🏸',n:'badminton'},{e:'🏒',n:'ice hockey'},{e:'🏑',n:'field hockey'},{e:'🥍',n:'lacrosse'},{e:'🏏',n:'cricket game'},{e:'🪃',n:'boomerang'},{e:'🥅',n:'goal net'},{e:'⛳',n:'flag in hole'},{e:'🪁',n:'bow and arrow'},{e:'🏹',n:'bow and arrow'},{e:'🎣',n:'fishing pole'},{e:'🤿',n:'diving mask'},{e:'🥊',n:'boxing glove'},{e:'🥋',n:'martial arts uniform'},{e:'🎽',n:'running shirt'},{e:'🛹',n:'skateboard'},{e:'🛷',n:'sled'},{e:'⛸️',n:'ice skate'},{e:'🥌',n:'curling stone'},{e:'🎿',n:'skis'},{e:'⛷️',n:'skier'},{e:'🏂',n:'snowboarder'},{e:'🪂',n:'parachute'},{e:'🏋️',n:'person lifting weights'},{e:'🤼',n:'people wrestling'},{e:'🤸',n:'person cartwheeling'},{e:'⛹️',n:'person bouncing ball'},{e:'🤺',n:'person fencing'},{e:'🏇',n:'horse racing'},{e:'🧘',n:'person in lotus position'},{e:'🏄',n:'person surfing'},{e:'🏊',n:'person swimming'},{e:'🤽',n:'person playing water polo'},{e:'🚣',n:'person rowing boat'},{e:'🧗',n:'person climbing'},{e:'🚵',n:'person mountain biking'},{e:'🚴',n:'person biking'},{e:'🏆',n:'trophy'},{e:'🥇',n:'1st place medal'},{e:'🥈',n:'2nd place medal'},{e:'🥉',n:'3rd place medal'},{e:'🏅',n:'sports medal'},{e:'🎖️',n:'military medal'},{e:'🎗️',n:'reminder ribbon'},{e:'🎫',n:'ticket'},{e:'🎟️',n:'admission tickets'},{e:'🎪',n:'circus tent'},{e:'🤹',n:'person juggling'},{e:'🎭',n:'performing arts'},{e:'🩰',n:'ballet shoes'},{e:'🎨',n:'artist palette'},{e:'🖼️',n:'framed picture'},{e:'🎰',n:'slot machine'},{e:'🎲',n:'game die'},{e:'♟️',n:'chess pawn'},{e:'🧩',n:'puzzle piece'},{e:'🎮',n:'video game'},{e:'🕹️',n:'joystick'},{e:'🎯',n:'bullseye'},{e:'🎳',n:'bowling'},{e:'🎻',n:'violin'},{e:'🪕',n:'banjo'},{e:'🎸',n:'guitar'},{e:'🥁',n:'drum'},{e:'🪘',n:'long drum'},{e:'🎷',n:'saxophone'},{e:'🎺',n:'trumpet'},{e:'🎹',n:'musical keyboard'},{e:'🪗',n:'accordion'},{e:'🎵',n:'musical note'},{e:'🎶',n:'musical notes'},{e:'🎙️',n:'studio microphone'},{e:'🎚️',n:'level slider'},{e:'🎛️',n:'control knobs'},{e:'🎤',n:'microphone'},{e:'🎧',n:'headphone'},{e:'🎼',n:'musical score'},{e:'📻',n:'radio'},{e:'🎃',n:'jack-o-lantern'},{e:'🎆',n:'fireworks'},{e:'🎇',n:'sparkler'},{e:'🧨',n:'firecracker'},{e:'🎉',n:'party popper'},{e:'🎊',n:'confetti ball'},{e:'🧧',n:'red envelope'},{e:'🎁',n:'wrapped gift'},
    ],
  },
  {
    id: 'objects',
    label: 'Objects',
    icon: '💡',
    emoji: [
      {e:'⌚',n:'watch'},{e:'📱',n:'mobile phone'},{e:'💻',n:'laptop'},{e:'⌨️',n:'keyboard'},{e:'🖥️',n:'desktop computer'},{e:'🖨️',n:'printer'},{e:'🖱️',n:'computer mouse'},{e:'🖲️',n:'trackball'},{e:'💾',n:'floppy disk'},{e:'💿',n:'optical disk'},{e:'📀',n:'dvd'},{e:'🧮',n:'abacus'},{e:'📷',n:'camera'},{e:'📸',n:'camera with flash'},{e:'📹',n:'video camera'},{e:'🎥',n:'movie camera'},{e:'📽️',n:'film projector'},{e:'🎞️',n:'film frames'},{e:'📞',n:'telephone receiver'},{e:'☎️',n:'telephone'},{e:'📟',n:'pager'},{e:'📠',n:'fax machine'},{e:'📺',n:'television'},{e:'📻',n:'radio'},{e:'🧭',n:'compass'},{e:'⏱️',n:'stopwatch'},{e:'⏰',n:'alarm clock'},{e:'🕰️',n:'mantelpiece clock'},{e:'⌛',n:'hourglass done'},{e:'⏳',n:'hourglass not done'},{e:'📡',n:'satellite antenna'},{e:'🔋',n:'battery'},{e:'🔌',n:'electric plug'},{e:'💡',n:'light bulb'},{e:'🔦',n:'flashlight'},{e:'🕯️',n:'candle'},{e:'🪔',n:'diya lamp'},{e:'🧯',n:'fire extinguisher'},{e:'🛢️',n:'oil drum'},{e:'💸',n:'money with wings'},{e:'💵',n:'dollar banknote'},{e:'💴',n:'yen banknote'},{e:'💶',n:'euro banknote'},{e:'💷',n:'pound banknote'},{e:'💰',n:'money bag'},{e:'💳',n:'credit card'},{e:'💎',n:'gem stone'},{e:'⚖️',n:'balance scale'},{e:'🔧',n:'wrench'},{e:'🪛',n:'screwdriver'},{e:'🔨',n:'hammer'},{e:'⚒️',n:'hammer and pick'},{e:'🛠️',n:'hammer and wrench'},{e:'⛏️',n:'pick'},{e:'🔩',n:'nut and bolt'},{e:'🪤',n:'mousetrap'},{e:'🗜️',n:'clamp'},{e:'⚙️',n:'gear'},{e:'🗡️',n:'dagger'},{e:'⚔️',n:'crossed swords'},{e:'🛡️',n:'shield'},{e:'🪝',n:'hook'},{e:'🪜',n:'ladder'},{e:'🧲',n:'magnet'},{e:'🪣',n:'bucket'},{e:'💊',n:'pill'},{e:'💉',n:'syringe'},{e:'🩸',n:'drop of blood'},{e:'🩹',n:'adhesive bandage'},{e:'🩺',n:'stethoscope'},{e:'🩻',n:'x-ray'},{e:'🧪',n:'test tube'},{e:'🧫',n:'petri dish'},{e:'🧬',n:'dna'},{e:'🔬',n:'microscope'},{e:'🔭',n:'telescope'},{e:'🛒',n:'shopping cart'},{e:'🚪',n:'door'},{e:'🪑',n:'chair'},{e:'🛋️',n:'couch and lamp'},{e:'🪞',n:'mirror'},{e:'🛏️',n:'bed'},{e:'🛁',n:'bathtub'},{e:'🪠',n:'plunger'},{e:'🚽',n:'toilet'},{e:'🪒',n:'razor'},{e:'🧴',n:'lotion bottle'},{e:'🧷',n:'safety pin'},{e:'🧹',n:'broom'},{e:'🧺',n:'basket'},{e:'🧻',n:'roll of paper'},{e:'🧼',n:'soap'},{e:'🫧',n:'bubbles'},{e:'🪥',n:'toothbrush'},{e:'🧽',n:'sponge'},{e:'📦',n:'package'},{e:'📫',n:'closed mailbox with raised flag'},{e:'📪',n:'closed mailbox with lowered flag'},{e:'📬',n:'open mailbox with raised flag'},{e:'📮',n:'postbox'},{e:'🗳️',n:'ballot box with ballot'},{e:'✏️',n:'pencil'},{e:'✒️',n:'black nib'},{e:'🖊️',n:'pen'},{e:'🖋️',n:'fountain pen'},{e:'📝',n:'memo'},{e:'📁',n:'file folder'},{e:'📂',n:'open file folder'},{e:'🗂️',n:'card index dividers'},{e:'🗃️',n:'card file box'},{e:'🗄️',n:'file cabinet'},{e:'🗑️',n:'wastebasket'},{e:'🔒',n:'locked'},{e:'🔓',n:'unlocked'},{e:'🔏',n:'locked with pen'},{e:'🔐',n:'locked with key'},{e:'🔑',n:'key'},{e:'🗝️',n:'old key'},{e:'🔗',n:'link'},{e:'📎',n:'paperclip'},{e:'📌',n:'pushpin'},{e:'📍',n:'round pushpin'},{e:'📏',n:'straight ruler'},{e:'📐',n:'triangular ruler'},{e:'✂️',n:'scissors'},{e:'🖇️',n:'linked paperclips'},
    ],
  },
  {
    id: 'symbols',
    label: 'Symbols',
    icon: '🔣',
    emoji: [
      {e:'❤️',n:'red heart'},{e:'🧡',n:'orange heart'},{e:'💛',n:'yellow heart'},{e:'💚',n:'green heart'},{e:'💙',n:'blue heart'},{e:'💜',n:'purple heart'},{e:'🖤',n:'black heart'},{e:'🤍',n:'white heart'},{e:'🤎',n:'brown heart'},{e:'♥️',n:'heart suit'},{e:'♠️',n:'spade suit'},{e:'♣️',n:'club suit'},{e:'♦️',n:'diamond suit'},{e:'☑️',n:'check box with check'},{e:'✅',n:'check mark button'},{e:'❎',n:'cross mark button'},{e:'🔲',n:'black square button'},{e:'🔳',n:'white square button'},{e:'◼️',n:'black medium square'},{e:'◻️',n:'white medium square'},{e:'🔶',n:'large orange diamond'},{e:'🔷',n:'large blue diamond'},{e:'🔸',n:'small orange diamond'},{e:'🔹',n:'small blue diamond'},{e:'🟥',n:'red square'},{e:'🟧',n:'orange square'},{e:'🟨',n:'yellow square'},{e:'🟩',n:'green square'},{e:'🟦',n:'blue square'},{e:'🟪',n:'purple square'},{e:'🟫',n:'brown square'},{e:'⬛',n:'black large square'},{e:'⬜',n:'white large square'},{e:'🔴',n:'red circle'},{e:'🟠',n:'orange circle'},{e:'🟡',n:'yellow circle'},{e:'🟢',n:'green circle'},{e:'🔵',n:'blue circle'},{e:'🟣',n:'purple circle'},{e:'🔘',n:'radio button'},{e:'♻️',n:'recycling symbol'},{e:'✔️',n:'check mark'},{e:'❌',n:'cross mark'},{e:'❓',n:'question mark'},{e:'❔',n:'white question mark'},{e:'❕',n:'white exclamation mark'},{e:'❗',n:'exclamation mark'},{e:'‼️',n:'double exclamation mark'},{e:'⁉️',n:'exclamation question mark'},{e:'🔅',n:'dim button'},{e:'🔆',n:'bright button'},{e:'🔔',n:'bell'},{e:'🔕',n:'bell with slash'},{e:'🔇',n:'muted speaker'},{e:'🔈',n:'speaker low volume'},{e:'🔉',n:'speaker medium volume'},{e:'🔊',n:'speaker high volume'},{e:'📣',n:'megaphone'},{e:'📢',n:'loudspeaker'},{e:'⚡',n:'high voltage'},{e:'🌀',n:'cyclone'},{e:'☮️',n:'peace symbol'},{e:'✝️',n:'latin cross'},{e:'☪️',n:'star and crescent'},{e:'🕉️',n:'om'},{e:'☸️',n:'wheel of dharma'},{e:'✡️',n:'star of david'},{e:'🔯',n:'dotted six-pointed star'},{e:'🕎',n:'menorah'},{e:'☯️',n:'yin yang'},{e:'☦️',n:'orthodox cross'},{e:'🛐',n:'place of worship'},{e:'⛎',n:'ophiuchus'},{e:'♈',n:'aries'},{e:'♉',n:'taurus'},{e:'♊',n:'gemini'},{e:'♋',n:'cancer'},{e:'♌',n:'leo'},{e:'♍',n:'virgo'},{e:'♎',n:'libra'},{e:'♏',n:'scorpio'},{e:'♐',n:'sagittarius'},{e:'♑',n:'capricorn'},{e:'♒',n:'aquarius'},{e:'♓',n:'pisces'},{e:'🆔',n:'id button'},{e:'⚛️',n:'atom symbol'},{e:'🉑',n:'japanese acceptable button'},{e:'☢️',n:'radioactive'},{e:'☣️',n:'biohazard'},{e:'🔞',n:'no one under eighteen'},{e:'📵',n:'no mobile phones'},{e:'🚫',n:'prohibited'},{e:'⛔',n:'no entry'},{e:'🚭',n:'no smoking'},{e:'🚯',n:'no littering'},{e:'🚱',n:'non-potable water'},{e:'🚳',n:'no bicycles'},{e:'⬆️',n:'up arrow'},{e:'↗️',n:'up-right arrow'},{e:'➡️',n:'right arrow'},{e:'↘️',n:'down-right arrow'},{e:'⬇️',n:'down arrow'},{e:'↙️',n:'down-left arrow'},{e:'⬅️',n:'left arrow'},{e:'↖️',n:'up-left arrow'},{e:'↕️',n:'up-down arrow'},{e:'↔️',n:'left-right arrow'},{e:'↩️',n:'right arrow curving left'},{e:'↪️',n:'left arrow curving right'},{e:'⤴️',n:'right arrow curving up'},{e:'⤵️',n:'right arrow curving down'},{e:'🔃',n:'clockwise vertical arrows'},{e:'🔄',n:'counterclockwise arrows button'},{e:'🔙',n:'back arrow'},{e:'🔚',n:'end arrow'},{e:'🔛',n:'on arrow'},{e:'🔜',n:'soon arrow'},{e:'🔝',n:'top arrow'},
    ],
  },
  {
    id: 'flags',
    label: 'Flags',
    icon: '🏁',
    emoji: [
      {e:'🏁',n:'chequered flag'},{e:'🚩',n:'triangular flag'},{e:'🎌',n:'crossed flags'},{e:'🏴',n:'black flag'},{e:'🏳️',n:'white flag'},{e:'🏳️‍🌈',n:'rainbow flag'},{e:'🏳️‍⚧️',n:'transgender flag'},{e:'🏴‍☠️',n:'pirate flag'},{e:'🇺🇸',n:'flag united states'},{e:'🇬🇧',n:'flag united kingdom'},{e:'🇨🇦',n:'flag canada'},{e:'🇦🇺',n:'flag australia'},{e:'🇩🇪',n:'flag germany'},{e:'🇫🇷',n:'flag france'},{e:'🇯🇵',n:'flag japan'},{e:'🇰🇷',n:'flag south korea'},{e:'🇨🇳',n:'flag china'},{e:'🇮🇳',n:'flag india'},{e:'🇧🇷',n:'flag brazil'},{e:'🇲🇽',n:'flag mexico'},{e:'🇷🇺',n:'flag russia'},{e:'🇮🇹',n:'flag italy'},{e:'🇪🇸',n:'flag spain'},{e:'🇵🇹',n:'flag portugal'},{e:'🇳🇱',n:'flag netherlands'},{e:'🇧🇪',n:'flag belgium'},{e:'🇸🇪',n:'flag sweden'},{e:'🇳🇴',n:'flag norway'},{e:'🇩🇰',n:'flag denmark'},{e:'🇫🇮',n:'flag finland'},{e:'🇦🇹',n:'flag austria'},{e:'🇨🇭',n:'flag switzerland'},{e:'🇵🇱',n:'flag poland'},{e:'🇨🇿',n:'flag czechia'},{e:'🇸🇰',n:'flag slovakia'},{e:'🇭🇺',n:'flag hungary'},{e:'🇷🇴',n:'flag romania'},{e:'🇧🇬',n:'flag bulgaria'},{e:'🇬🇷',n:'flag greece'},{e:'🇹🇷',n:'flag turkey'},{e:'🇮🇱',n:'flag israel'},{e:'🇸🇦',n:'flag saudi arabia'},{e:'🇦🇪',n:'flag united arab emirates'},{e:'🇮🇷',n:'flag iran'},{e:'🇮🇶',n:'flag iraq'},{e:'🇵🇰',n:'flag pakistan'},{e:'🇦🇫',n:'flag afghanistan'},{e:'🇹🇭',n:'flag thailand'},{e:'🇻🇳',n:'flag vietnam'},{e:'🇮🇩',n:'flag indonesia'},{e:'🇲🇾',n:'flag malaysia'},{e:'🇵🇭',n:'flag philippines'},{e:'🇸🇬',n:'flag singapore'},{e:'🇳🇿',n:'flag new zealand'},{e:'🇿🇦',n:'flag south africa'},{e:'🇳🇬',n:'flag nigeria'},{e:'🇰🇪',n:'flag kenya'},{e:'🇬🇭',n:'flag ghana'},{e:'🇪🇬',n:'flag egypt'},{e:'🇲🇦',n:'flag morocco'},{e:'🇹🇳',n:'flag tunisia'},{e:'🇩🇿',n:'flag algeria'},{e:'🇱🇾',n:'flag libya'},{e:'🇸🇩',n:'flag sudan'},{e:'🇪🇹',n:'flag ethiopia'},{e:'🇹🇿',n:'flag tanzania'},{e:'🇺🇬',n:'flag uganda'},{e:'🇷🇼',n:'flag rwanda'},{e:'🇲🇿',n:'flag mozambique'},{e:'🇿🇲',n:'flag zambia'},{e:'🇿🇼',n:'flag zimbabwe'},{e:'🇦🇴',n:'flag angola'},{e:'🇧🇼',n:'flag botswana'},{e:'🇸🇿',n:'flag eswatini'},{e:'🇦🇷',n:'flag argentina'},{e:'🇨🇱',n:'flag chile'},{e:'🇨🇴',n:'flag colombia'},{e:'🇵🇪',n:'flag peru'},{e:'🇻🇪',n:'flag venezuela'},{e:'🇺🇾',n:'flag uruguay'},{e:'🇵🇾',n:'flag paraguay'},{e:'🇧🇴',n:'flag bolivia'},{e:'🇪🇨',n:'flag ecuador'},{e:'🇬🇹',n:'flag guatemala'},{e:'🇨🇷',n:'flag costa rica'},{e:'🇵🇦',n:'flag panama'},{e:'🇨🇺',n:'flag cuba'},{e:'🇩🇴',n:'flag dominican republic'},{e:'🇵🇷',n:'flag puerto rico'},{e:'🇭🇰',n:'flag hong kong'},{e:'🇹🇼',n:'flag taiwan'},{e:'🇺🇦',n:'flag ukraine'},{e:'🇷🇸',n:'flag serbia'},{e:'🇭🇷',n:'flag croatia'},{e:'🇸🇮',n:'flag slovenia'},{e:'🇧🇦',n:'flag bosnia and herzegovina'},{e:'🇲🇰',n:'flag north macedonia'},{e:'🇦🇱',n:'flag albania'},{e:'🇲🇪',n:'flag montenegro'},{e:'🇽🇰',n:'flag kosovo'},{e:'🇱🇹',n:'flag lithuania'},{e:'🇱🇻',n:'flag latvia'},{e:'🇪🇪',n:'flag estonia'},{e:'🇮🇸',n:'flag iceland'},{e:'🇮🇪',n:'flag ireland'},
    ],
  },
];

// ── localStorage helpers ─────────────────────────────────────────────────────
const RECENT_KEY = 'ocean-recent-emoji';
const RECENT_MAX = 18;

function loadRecent(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRecent(emoji: string): void {
  if (typeof window === 'undefined') return;
  try {
    const prev = loadRecent();
    const next = [emoji, ...prev.filter(e => e !== emoji)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors
  }
}

// ── Debounce hook ────────────────────────────────────────────────────────────
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// ── Emoji name lookup ────────────────────────────────────────────────────────
const EMOJI_NAME_MAP = new Map<string, string>();
for (const cat of CATEGORIES) {
  for (const entry of cat.emoji) {
    EMOJI_NAME_MAP.set(entry.e, entry.n);
  }
}

function getEmojiName(e: string): string {
  return EMOJI_NAME_MAP.get(e) ?? e;
}

function getEmojiCode(e: string): string {
  const name = getEmojiName(e);
  // Find a matching alias or generate from name
  const alias = Object.entries(EMOJI_ALIASES).find(([, v]) => v === e)?.[0];
  return alias ? `:${alias}:` : `:${name.replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')}:`;
}

// ── Tooltip component ────────────────────────────────────────────────────────
interface TooltipState {
  emoji: string;
  x: number;
  y: number;
}

// ── Main component ───────────────────────────────────────────────────────────
export default function EmojiPicker({ onPick, onClose }: EmojiPickerProps) {
  const [query, setQuery] = useState('');
  const [activeCategoryId, setActiveCategoryId] = useState<string>('recent');
  const [skinToneIndex, setSkinToneIndex] = useState(0);
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [hoveredSkinEmoji, setHoveredSkinEmoji] = useState<string | null>(null);

  const customEmoji = useOnyxStore(s => s.customEmoji);
  const openCustomEmojiModal = useOnyxStore(s => s.openCustomEmojiModal);
  const incrementEmojiUsage = useOnyxStore(s => s.incrementEmojiUsage);
  const emojiUsageCounts = useOnyxStore(s => s.emojiUsageCounts);

  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const debouncedQuery = useDebounce(query, 150);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const applyTone = useCallback((e: string): string => {
    if (skinToneIndex === 0) return e;
    if (SKIN_TONE_CAPABLE.has(e)) {
      return e + SKIN_TONES[skinToneIndex];
    }
    return e;
  }, [skinToneIndex]);

  const handlePick = useCallback((raw: string) => {
    const final = applyTone(raw);
    saveRecent(final);
    setRecent(loadRecent());
    incrementEmojiUsage(final);
    onPick(final);
    onClose();
  }, [applyTone, onPick, onClose, incrementEmojiUsage]);

  const handleEmojiMouseEnter = useCallback((e: React.MouseEvent<HTMLButtonElement>, emoji: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const containerRect = rootRef.current?.getBoundingClientRect();
    if (!containerRect) return;
    setTooltip({
      emoji,
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.top - containerRect.top,
    });
    if (SKIN_TONE_CAPABLE.has(emoji)) {
      setHoveredSkinEmoji(emoji);
    }
  }, []);

  const handleEmojiMouseLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  const searchResults = useMemo<EmojiEntry[]>(() => {
    if (!debouncedQuery.trim()) return [];
    const q = debouncedQuery.toLowerCase();
    const seen = new Set<string>();
    const out: EmojiEntry[] = [];
    const aliasMatch = EMOJI_ALIASES[q];

    for (const cat of CATEGORIES) {
      for (const entry of cat.emoji) {
        if (seen.has(entry.e)) continue;
        const nameMatch = entry.n.includes(q);
        const aliases = EMOJI_TO_ALIASES[entry.e];
        const aliasHit = aliases?.some(a => a.includes(q)) ?? false;
        const exactAliasHit = aliasMatch === entry.e;
        if (nameMatch || aliasHit || exactAliasHit) {
          seen.add(entry.e);
          out.push(entry);
        }
      }
    }
    return out;
  }, [debouncedQuery]);

  const isSearching = debouncedQuery.trim().length > 0;

  const activeEmoji = useMemo<EmojiEntry[]>(() => {
    if (isSearching) return searchResults;
    if (activeCategoryId === 'recent') {
      return recent.map(e => ({ e, n: getEmojiName(e) }));
    }
    return CATEGORIES.find(c => c.id === activeCategoryId)?.emoji ?? [];
  }, [isSearching, searchResults, activeCategoryId, recent]);

  const mostUsed = useMemo<string[]>(() => {
    const entries = Object.entries(emojiUsageCounts);
    if (entries.length < 3) return [];
    return entries
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([emoji]) => emoji);
  }, [emojiUsageCounts]);

  const activeCategoryLabel = useMemo(() => {
    if (isSearching) return 'Search results';
    if (activeCategoryId === 'recent') return 'Recently used';
    if (activeCategoryId === 'custom') return 'Custom Emoji';
    return CATEGORIES.find(c => c.id === activeCategoryId)?.label ?? '';
  }, [isSearching, activeCategoryId]);

  const showMostUsed = mostUsed.length > 0 && !isSearching && activeCategoryId !== 'custom';

  const handleCategoryClick = useCallback((id: string) => {
    setActiveCategoryId(id);
    gridRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const skinToneVariants = useMemo<string[]>(() => {
    if (!hoveredSkinEmoji) return [];
    return SKIN_TONES.map(t => hoveredSkinEmoji + t);
  }, [hoveredSkinEmoji]);

  return (
    <div ref={rootRef} className="ep-root" role="dialog" aria-label="Emoji picker">
      {/* Floating tooltip */}
      {tooltip && (
        <div
          className="ep-tooltip"
          style={{ left: tooltip.x, top: tooltip.y - 4 }}
          aria-hidden="true"
        >
          <span className="ep-tooltip-name">{getEmojiName(tooltip.emoji)}</span>
          <span className="ep-tooltip-code">{getEmojiCode(tooltip.emoji)}</span>
        </div>
      )}

      {/* Header: search + skin tone */}
      <div className="ep-header">
        <div className="ep-search-wrap">
          <svg className="ep-search-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            ref={searchRef}
            className="ep-search"
            type="text"
            placeholder="Search emoji…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-label="Search emoji"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button
              className="ep-search-clear"
              onClick={() => { setQuery(''); searchRef.current?.focus(); }}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
        <div className="ep-tones" role="group" aria-label="Skin tone">
          {SKIN_TONE_SWATCHES.map((color, i) => (
            <button
              key={i}
              className={`ep-tone${skinToneIndex === i ? ' ep-tone--active' : ''}`}
              style={{ background: color }}
              onClick={() => setSkinToneIndex(i)}
              title={SKIN_TONE_LABELS[i]}
              aria-pressed={skinToneIndex === i}
              aria-label={SKIN_TONE_LABELS[i]}
            />
          ))}
        </div>
      </div>

      {/* Skin tone variants strip */}
      {hoveredSkinEmoji && skinToneVariants.length > 0 && !isSearching && (
        <div className="ep-skin-variants" role="group" aria-label="Skin tone variants">
          {skinToneVariants.map((v, i) => (
            <button
              key={i}
              className="ep-skin-variant-btn"
              onClick={() => handlePick(v)}
              title={SKIN_TONE_LABELS[i]}
              aria-label={`${getEmojiName(hoveredSkinEmoji)} ${SKIN_TONE_LABELS[i]}`}
              onMouseLeave={() => setHoveredSkinEmoji(null)}
            >
              {v}
            </button>
          ))}
        </div>
      )}

      {/* Category tabs */}
      {!isSearching && (
        <div className="ep-cats" role="tablist" aria-label="Emoji categories">
          <button
            role="tab"
            aria-selected={activeCategoryId === 'recent'}
            className={`ep-cat${activeCategoryId === 'recent' ? ' ep-cat--active' : ''}`}
            onClick={() => handleCategoryClick('recent')}
            title="Recently used"
          >
            🕐
          </button>
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              role="tab"
              aria-selected={activeCategoryId === cat.id}
              className={`ep-cat${activeCategoryId === cat.id ? ' ep-cat--active' : ''}`}
              onClick={() => handleCategoryClick(cat.id)}
              title={cat.label}
            >
              {cat.icon}
            </button>
          ))}
          <button
            role="tab"
            aria-selected={activeCategoryId === 'custom'}
            className={`ep-cat${activeCategoryId === 'custom' ? ' ep-cat--active' : ''}`}
            onClick={() => handleCategoryClick('custom')}
            title="Custom Emoji"
          >
            ✨
          </button>
        </div>
      )}

      {/* Most Used strip */}
      {showMostUsed && (
        <div className="ep-most-used">
          <div className="ep-most-used-label">Most Used</div>
          <div className="ep-most-used-row">
            {mostUsed.map((emoji, idx) => (
              <button
                key={`mu-${emoji}-${idx}`}
                className="ep-emoji ep-emoji--small"
                onClick={() => handlePick(emoji)}
                onMouseEnter={e => handleEmojiMouseEnter(e, emoji)}
                onMouseLeave={handleEmojiMouseLeave}
                title={getEmojiName(emoji)}
                aria-label={getEmojiName(emoji)}
              >
                {applyTone(emoji)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Section label */}
      <div className="ep-section-label">{activeCategoryLabel}</div>

      {/* Custom emoji tab view */}
      {activeCategoryId === 'custom' && !isSearching ? (
        <div className="ep-custom-tab">
          <div className="ep-custom-grid">
            {customEmoji.length > 0 ? (
              customEmoji.map(ce => (
                <button
                  key={ce.name}
                  className="ep-custom-item"
                  onClick={() => { onPick(`:${ce.name}:`); onClose(); }}
                  title={`:${ce.name}:`}
                  aria-label={ce.name}
                >
                  <img src={ce.url} alt={ce.name} className="ep-custom-img" />
                </button>
              ))
            ) : (
              <div className="ep-empty ep-empty--custom">
                No custom emoji yet. Add some below.
              </div>
            )}
          </div>
          <button
            className="ep-custom-add-btn"
            onClick={() => { onClose(); openCustomEmojiModal(); }}
          >
            ✨ Manage Custom Emoji
          </button>
        </div>
      ) : (
        <div
          ref={gridRef}
          className="ep-grid"
          role="grid"
          aria-label={activeCategoryLabel}
        >
          {activeEmoji.length > 0 ? (
            activeEmoji.map((entry, idx) => (
              <button
                key={`${entry.e}-${idx}`}
                className="ep-emoji"
                onClick={() => handlePick(entry.e)}
                onMouseEnter={e => handleEmojiMouseEnter(e, entry.e)}
                onMouseLeave={handleEmojiMouseLeave}
                title={entry.n}
                role="gridcell"
                aria-label={entry.n}
              >
                {applyTone(entry.e)}
              </button>
            ))
          ) : (
            <div className="ep-empty">
              {isSearching ? `No results for "${debouncedQuery}"` : 'No recently used emoji'}
            </div>
          )}
        </div>
      )}

      <style>{`
        .ep-root {
          position: absolute;
          bottom: calc(100% + 8px);
          right: 0;
          width: 360px;
          height: 440px;
          display: flex;
          flex-direction: column;
          background: rgba(6, 16, 29, 0.92);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          box-shadow: 0 8px 48px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4);
          z-index: 200;
          overflow: visible;
          animation: ep-enter 180ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }

        @keyframes ep-enter {
          from { opacity: 0; transform: scale(0.92) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }

        /* ── Tooltip ── */
        .ep-tooltip {
          position: absolute;
          transform: translate(-50%, -100%);
          background: rgba(3, 8, 16, 0.95);
          border: 1px solid rgba(14, 165, 233, 0.2);
          border-radius: 8px;
          padding: 5px 9px;
          pointer-events: none;
          z-index: 300;
          white-space: nowrap;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.5);
        }

        .ep-tooltip-name {
          font-size: 11px;
          color: var(--text-primary);
          font-weight: 500;
          text-transform: capitalize;
        }

        .ep-tooltip-code {
          font-size: 10px;
          color: var(--text-muted);
          font-family: var(--font-mono);
          letter-spacing: 0.3px;
        }

        /* ── Skin variants strip ── */
        .ep-skin-variants {
          display: flex;
          gap: 2px;
          padding: 4px 10px 0;
          flex-shrink: 0;
          background: rgba(14, 165, 233, 0.04);
          border-bottom: 1px solid rgba(14, 165, 233, 0.08);
        }

        .ep-skin-variant-btn {
          width: 32px;
          height: 32px;
          border: none;
          background: none;
          cursor: pointer;
          border-radius: 8px;
          font-size: 19px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 100ms ease, transform 100ms cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .ep-skin-variant-btn:hover {
          background: rgba(255,255,255,0.08);
          transform: scale(1.25);
        }

        /* ── Header ── */
        .ep-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px 0;
          flex-shrink: 0;
          border-radius: 16px 16px 0 0;
          overflow: hidden;
        }

        .ep-search-wrap {
          position: relative;
          flex: 1;
          min-width: 0;
        }

        .ep-search-icon {
          position: absolute;
          left: 10px;
          top: 50%;
          transform: translateY(-50%);
          width: 13px;
          height: 13px;
          color: var(--text-muted);
          pointer-events: none;
          flex-shrink: 0;
        }

        .ep-search {
          width: 100%;
          background: var(--bg-elevated);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 999px;
          padding: 7px 30px 7px 32px;
          font-size: 13px;
          color: var(--text-primary);
          outline: none;
          transition: border-color 150ms ease, box-shadow 150ms ease;
          box-sizing: border-box;
          height: 36px;
        }

        .ep-search:focus {
          border-color: rgba(14, 165, 233, 0.4);
          box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.15);
        }

        .ep-search::placeholder {
          color: var(--text-muted);
        }

        .ep-search-clear {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 13px;
          line-height: 1;
          padding: 0 2px;
          transition: color 150ms ease;
        }

        .ep-search-clear:hover {
          color: var(--text-primary);
        }

        /* ── Skin tones ── */
        .ep-tones {
          display: flex;
          gap: 3px;
          flex-shrink: 0;
        }

        .ep-tone {
          width: 17px;
          height: 17px;
          border-radius: 50%;
          border: 2px solid transparent;
          cursor: pointer;
          transition: transform 150ms ease, border-color 150ms ease;
          flex-shrink: 0;
        }

        .ep-tone:hover {
          transform: scale(1.2);
        }

        .ep-tone--active {
          border-color: var(--accent);
          box-shadow: 0 0 0 1px var(--accent);
          transform: scale(1.15);
        }

        /* ── Category tabs ── */
        .ep-cats {
          display: flex;
          padding: 8px 10px 0;
          gap: 1px;
          flex-shrink: 0;
          overflow-x: auto;
          scrollbar-width: none;
          height: 40px;
          align-items: center;
        }

        .ep-cats::-webkit-scrollbar {
          display: none;
        }

        .ep-cat {
          flex-shrink: 0;
          width: 28px;
          height: 28px;
          border: none;
          background: none;
          cursor: pointer;
          border-radius: 6px;
          font-size: 15px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 150ms ease, transform 150ms ease, filter 150ms ease;
          position: relative;
          filter: grayscale(0.3) opacity(0.65);
        }

        .ep-cat:hover {
          background: rgba(255,255,255,0.06);
          transform: scale(1.12);
          filter: grayscale(0) opacity(1);
        }

        .ep-cat--active {
          background: rgba(14, 165, 233, 0.1);
          filter: grayscale(0) opacity(1);
        }

        .ep-cat--active::after {
          content: '';
          position: absolute;
          bottom: -1px;
          left: 50%;
          transform: translateX(-50%);
          width: 18px;
          height: 2px;
          background: var(--accent);
          border-radius: 1px;
        }

        /* ── Most used strip ── */
        .ep-most-used {
          flex-shrink: 0;
          padding: 5px 10px 0;
          border-bottom: 1px solid rgba(14, 165, 233, 0.08);
        }

        .ep-most-used-label {
          font-size: 9px;
          font-weight: 700;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.9px;
          margin-bottom: 2px;
        }

        .ep-most-used-row {
          display: flex;
          gap: 1px;
          flex-wrap: nowrap;
          padding-bottom: 4px;
        }

        /* ── Section label ── */
        .ep-section-label {
          padding: 5px 12px 3px;
          font-size: 9px;
          font-weight: 700;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.9px;
          flex-shrink: 0;
        }

        /* ── Emoji grid ── */
        .ep-grid {
          flex: 1;
          display: grid;
          grid-template-columns: repeat(8, 1fr);
          gap: 1px;
          padding: 2px 8px 8px;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: rgba(14,165,233,0.15) transparent;
          align-content: start;
        }

        .ep-grid::-webkit-scrollbar {
          width: 4px;
        }

        .ep-grid::-webkit-scrollbar-track {
          background: transparent;
        }

        .ep-grid::-webkit-scrollbar-thumb {
          background: rgba(14,165,233,0.15);
          border-radius: 2px;
        }

        .ep-grid::-webkit-scrollbar-thumb:hover {
          background: rgba(14,165,233,0.3);
        }

        .ep-emoji {
          width: 36px;
          height: 36px;
          border: none;
          background: none;
          cursor: pointer;
          border-radius: 8px;
          font-size: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 100ms ease, transform 100ms cubic-bezier(0.34, 1.56, 0.64, 1);
          line-height: 1;
          padding: 0;
          position: relative;
          z-index: 0;
        }

        .ep-emoji--small {
          width: 30px;
          height: 30px;
          font-size: 17px;
        }

        .ep-emoji:hover {
          background: rgba(255,255,255,0.08);
          transform: scale(1.25);
          z-index: 1;
        }

        .ep-emoji:active {
          transform: scale(0.92);
          background: rgba(14, 165, 233, 0.12);
        }

        /* ── Empty state ── */
        .ep-empty {
          grid-column: 1 / -1;
          padding: 32px 12px;
          text-align: center;
          color: var(--text-muted);
          font-size: 13px;
          line-height: 1.5;
        }

        /* ── Custom emoji tab ── */
        .ep-custom-tab {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .ep-custom-grid {
          flex: 1;
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 6px;
          padding: 8px;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: rgba(14,165,233,0.15) transparent;
          align-content: start;
        }

        .ep-custom-item {
          width: 64px;
          height: 64px;
          border: none;
          background: var(--bg-elevated);
          cursor: pointer;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 4px;
          transition: background 150ms ease, transform 150ms ease;
        }

        .ep-custom-item:hover {
          background: rgba(255,255,255,0.07);
          transform: scale(1.08);
        }

        .ep-custom-img {
          width: 48px;
          height: 48px;
          object-fit: contain;
          border-radius: 2px;
        }

        .ep-empty--custom {
          grid-column: 1 / -1;
        }

        .ep-custom-add-btn {
          flex-shrink: 0;
          margin: 6px 8px 8px;
          background: rgba(14, 165, 233, 0.08);
          border: 1px solid rgba(14, 165, 233, 0.25);
          border-radius: 8px;
          color: var(--accent);
          font-size: 12px;
          font-weight: 600;
          padding: 8px 12px;
          cursor: pointer;
          transition: background 150ms ease, border-color 150ms ease;
        }

        .ep-custom-add-btn:hover {
          background: rgba(14, 165, 233, 0.16);
          border-color: var(--accent);
        }
      `}</style>
    </div>
  );
}
