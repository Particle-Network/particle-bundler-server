import { FetchRequest, JsonRpcProvider, Network, Wallet } from 'ethers';
import { PROVIDER_FETCH_TIMEOUT } from '../src/common/common-types';
import { getBundlerChainConfig } from '../src/configs/bundler-common';

const data = `0x00000000000000000000000000000000000000000000000000000000000000006080806040523461001657610fef908161001c8239f35b600080fdfe6040608081526004908136101561001557600080fd5b6000803560e01c8063032ff9f1146103dd5780631626ba7e146103dd57806373016096146101fb5780638d2bc52914610187578063a3f4df7e14610120578063ffa1ad74146100bf5763fff35b721461006e575b600080fd5b346100b8576003199082823601126100b85783359167ffffffffffffffff83116100bb576101609083360301126100b857506020926100b19160243591016106b1565b9051908152f35b80fd5b5080fd5b5090346100bb57816003193601126100bb57805161011c916100e08261041b565b600582527f302e322e30000000000000000000000000000000000000000000000000000000602083015251918291602083526020830190610637565b0390f35b5090346100bb57816003193601126100bb57805161011c91610141826103e9565b602282527f506173734b657973204f776e657273686970205265676973747279204d6f64756020830152616c6560f01b8183015251918291602083526020830190610637565b5091346101f75760203660031901126101f7573573ffffffffffffffffffffffffffffffffffffffff81168091036101f757918192815280602052209061011c82549160606101dd60026001870154960161056e565b918051958695865260208601528401526060830190610637565b8280fd5b50346100b85760603660031901126100b85760443567ffffffffffffffff8082116101f757366023830112156101f75781850135928184116100b85736602485850101116100b857338152602095818752858220541515806103ce575b6103b757600261028487519561026d876103e9565b833587528987019760243589526024369201610475565b95878601968752338452838952878420955186555194600195868201550194519081519384116103a457506102b98554610534565b601f811161035e575b508691601f84116001146102ff57918394918493946102f4575b50501b916000199060031b1c19161790555b51308152f35b0151925038806102dc565b919083601f198116878552898520945b8a88838310610347575050501061032e575b505050811b0190556102ee565b015160001960f88460031b161c19169055388080610321565b86860151885590960195948501948793500161030f565b858352878320601f850160051c81019189861061039a575b601f0160051c019085905b82811061038f5750506102c2565b848155018590610381565b9091508190610376565b634e487b7160e01b835260419052602482fd5b602490865190632c4dfb7d60e21b82523390820152fd5b50600186832001541515610258565b505050506100696104ca565b6060810190811067ffffffffffffffff82111761040557604052565b634e487b7160e01b600052604160045260246000fd5b6040810190811067ffffffffffffffff82111761040557604052565b90601f8019910116810190811067ffffffffffffffff82111761040557604052565b67ffffffffffffffff811161040557601f01601f191660200190565b92919261048182610459565b9161048f6040519384610437565b829481845281830111610069578281602093846000960137010152565b9080601f83011215610069578160206104c793359101610475565b90565b50346100695760403660031901126100695760243567ffffffffffffffff81116100695761050961050160209236906004016104ac565b60043561091a565b6040517fffffffff000000000000000000000000000000000000000000000000000000009091168152f35b90600182811c92168015610564575b602083101461054e57565b634e487b7160e01b600052602260045260246000fd5b91607f1691610543565b906040519182600082549261058284610534565b9081845260019485811690816000146105f157506001146105ae575b50506105ac92500383610437565b565b9093915060005260209081600020936000915b8183106105d95750506105ac9350820101388061059e565b855488840185015294850194879450918301916105c1565b9150506105ac94506020925060ff191682840152151560051b820101388061059e565b60005b8381106106275750506000910152565b8181015183820152602001610617565b9060209161065081518092818552858086019101610614565b601f01601f1916010190565b81601f8201121561006957805161067281610459565b926106806040519485610437565b81845260208284010111610069576104c79160208085019101610614565b519065ffffffffffff8216820361006957565b61014081013590601e198136030182121561006957019182359067ffffffffffffffff9081831161006957602090818601938036038513610069578601604094858883031261006957359084821161006957859184806107159301918a01016104ac565b96013573ffffffffffffffffffffffffffffffffffffffff81160361006957855186018487820312610069578287015190848211610069578591848061075f9301918a010161065c565b960151156108e757855186019260a0878486019503126100695761078483880161069e565b61078f86890161069e565b9160608901519560808a0151828111610069578a019981603f8c01121561006957868b01519a838c11610405578b60051b8a8981519e8f906107d383860183610437565b8152019183010191848311610069578b8a9101915b8383106108d7575050505060a08101519283116100695761080b9201860161065c565b96865191858301937fffffffffffff0000000000000000000000000000000000000000000000000000809260d01b16855260d01b166026830152602c820152602c8152610857816103e9565b519020926000935b87518510156108aa57838560051b890101519086600083831060001461089a5750506000528352610894856000205b946108f5565b9361085f565b909161089493825286522061088e565b92509493509450839150036108d0576108c291610957565b6108cb57600190565b600090565b5050600190565b82518152918101918a91016107e8565b94925050506108c291610957565b60001981146109045760010190565b634e487b7160e01b600052601160045260246000fd5b9061092491610957565b61094c577fffffffff0000000000000000000000000000000000000000000000000000000090565b630b135d3f60e11b90565b919091825183019060209060c08583850194031261006957604094858101519360608201519260808301519267ffffffffffffffff938481116100695783876109a29284010161065c565b9360a08201518181116100695784886109bd9285010161065c565b9360c083015191821161006957876109da926109f394010161065c565b91895190878201528681526109ee8161041b565b610e29565b9060008251600281119081610cb1575b5015610c3857506002905b82519182039182116109045790869392918a610a2983610459565b92610a3682519485610437565b808452610a4281610459565b8488019590601f190136873760005b828110610bb1575050508560009593610ac29593610ab29351948592610a9385610a848187019a8b815193849201610614565b85019151809387840190610614565b01610aa682518093868085019101610614565b01038084520182610437565b8a51928392839251928391610614565b8101039060025afa15610ba6576000610b1884928251610b088a8051809388610af48184019788815193849201610614565b820190898201520387810184520182610437565b8951928392839251928391610614565b8101039060025afa15610b9b5760005192336000526000835285600020610b5b6002885192610b46846103e9565b8054845260018101549684019687520161056e565b8782015280511580610b92575b610b7b576104c795965051925193610d0d565b865163ce777ecf60e01b8152336004820152602490fd5b50835115610b68565b84513d6000823e3d90fd5b85513d6000823e3d90fd5b909250610bed9193949596975060ff60f81b602b60f81b81610bd38487610e02565b511603610bfb5750602d610be78288610e02565b536108f5565b918c918a9796959493610a51565b602f60f81b81610c0b8487610e02565b511603610c1f5750605f610be78288610e02565b610c298285610e02565b511660001a610be78288610e02565b908251600181119081610c55575b5015610a0e5760019150610a0e565b600019810191508111610c9d57603d60f81b907fff0000000000000000000000000000000000000000000000000000000000000090610c949086610e02565b51161438610c46565b634e487b7160e01b83526011600452602483fd5b600119810191508111610cf957603d60f81b907fff0000000000000000000000000000000000000000000000000000000000000090610cf09086610e02565b51161438610a03565b634e487b7160e01b82526011600452602482fd5b93919290927f7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a88111610df857604051936020850195865260408501526060840152608083015260a082015260a0815260c0810181811067ffffffffffffffff82111761040557604052600080928192519073c2b78104907f722dabac4c69f826a522b2754de45afa903d15610df0573d91610da783610459565b92610db56040519485610437565b83523d82602085013e5b15610ddc576020828051810103126100b857506020015160011490565b634e487b7160e01b81526001600452602490fd5b606091610dbf565b5050505050600090565b908151811015610e13570160200190565b634e487b7160e01b600052603260045260246000fd5b805115610f9457604051610e3c816103e9565b604081527f4142434445464748494a4b4c4d4e4f505152535455565758595a61626364656660208201527f6768696a6b6c6d6e6f707172737475767778797a303132333435363738392b2f604082015281516002928382018092116109045760038092049384811b947f3fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff8116036109045792610ef0610eda86610459565b95610ee86040519788610437565b808752610459565b6020860190601f190136823793829183518401925b838110610f435750505050510680600114610f3057600214610f25575090565b603d90600019015390565b50603d9081600019820153600119015390565b85600491979293949701918251600190603f9082828260121c16880101518453828282600c1c16880101518385015382828260061c1688010151888501531685010151878201530195929190610f05565b506040516020810181811067ffffffffffffffff82111761040557604052600081529056fea26469706673582212202459f26797dbe7de2bf782b774713fe38ada82390494d3873d1fcd7878c5762664736f6c63430008110033`;

const passkeyAddress = '0x1900547717B9800384641f6F3252A10Ed403632F';
export const deployPassKeyModule = async (chainId: number, signer: Wallet) => {
    const rpcUrl = getBundlerChainConfig(chainId).rpcUrl;
    const network = new Network('', chainId);
    const fetchRequest = new FetchRequest(rpcUrl);
    fetchRequest.timeout = PROVIDER_FETCH_TIMEOUT;
    const provider = new JsonRpcProvider(fetchRequest, network, { batchMaxCount: 1, staticNetwork: network });
    signer = signer.connect(provider);

    const feeData = await provider.getFeeData();

    const code = await provider.getCode(passkeyAddress);
    if (code.length > 2) {
        console.log('Passk module already deployed');
        return;
    }
    console.log(JSON.stringify(feeData))
    let gasPrice: any = feeData.gasPrice;
    let maxFeePerGas: any = null;
    let maxPriorityFeePerGas: any = null;

    const r = await signer.sendTransaction({
        type: 0,
        to: '0x4e59b44847b379578588920ca78fbf26c0b4956c',
        data,
        gasPrice,
        maxFeePerGas,
        maxPriorityFeePerGas,
    });

    console.log(r);
};
